import type { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from './db.ts';
import { decryptCredential } from './encryption.ts';
import { classifyPrompt } from './task-classifier.ts';
import { resolveModelRoute } from './model-router.ts';
import { getFreeChatModels, isFreeModel } from './model-registry.ts';
import { validatePrompt } from './rate-limit.ts';
import { getAppUrl } from './openrouter-oauth.ts';
import { routeToolIntent } from './plugins/intent-router.ts';
import { getFallbackConfig, type FallbackConfig } from './fallback-config.ts';
import type { TaskCategory, AiMode } from '../types/index.ts';

export const USER_QUOTA_ERROR_MESSAGE =
  'Your OpenRouter free usage limit has been reached. You can continue when your OpenRouter allowance resets or manage your OpenRouter account.';

interface MessageParam {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatStreamOptions {
  fetchFn?: typeof globalThis.fetch;
  configOverrides?: Partial<FallbackConfig>;
  overallDeadlineMs?: number;
  perAttemptTimeoutMs?: number;
  maxTotalAttempts?: number;
}

export interface ActiveRequestEntry {
  abortController: AbortController;
  userId: string;
  chatId: string;
  startedAt: number;
}

export interface CancelChatResult {
  success: boolean;
  status: number;
  error?: string;
}

// Active request registry for cancellation propagation
export const activeChatRequests = new Map<string, ActiveRequestEntry>();

export function cancelChatRequest(requestId: string, userId: string): CancelChatResult {
  const entry = activeChatRequests.get(requestId);
  if (!entry) {
    return { success: false, status: 404, error: 'Request not found or already completed' };
  }
  if (entry.userId !== userId) {
    return { success: false, status: 403, error: 'Unauthorized: cannot cancel another user\'s request' };
  }
  entry.abortController.abort(new Error('CLIENT_CANCELLED'));
  activeChatRequests.delete(requestId);
  return { success: true, status: 200 };
}

export async function handleChatCancel(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user || !user.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const requestId = req.body?.requestId || req.query?.requestId;
  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'requestId is required' });
  }
  const result = cancelChatRequest(requestId, user.id);
  if (!result.success) {
    return res.status(result.status).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(() => resolve(true), ms);
      return;
    }
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeChatStream(
  req: Request,
  res: Response,
  options?: ChatStreamOptions
) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // 1. Verify OpenRouter connection
  const conn = await db.getProviderConnection(user.id, 'openrouter');
  if (!conn || !conn.encrypted_credential) {
    return res.status(403).json({
      error: 'Connect OpenRouter to start chatting.',
      code: 'OPENROUTER_NOT_CONNECTED',
    });
  }

  // Decrypt user credential securely (never log this!)
  let userApiKey = '';
  try {
    userApiKey = decryptCredential(conn.encrypted_credential);
  } catch (err) {
    console.error('[Chat] Failed to decrypt user credential:', err);
    return res.status(500).json({
      error: 'Credential decryption error. Please reconnect OpenRouter.',
      code: 'DECRYPT_ERROR',
    });
  }

  // 2. Validate prompt
  const { prompt, chatId: incomingChatId, aiMode = 'auto', modelId, requestId: incomingRequestId } = req.body || {};
  const validation = validatePrompt(prompt);
  if (!validation.valid || !validation.cleanPrompt) {
    return res.status(400).json({ error: validation.error || 'Invalid prompt' });
  }
  const cleanPrompt = validation.cleanPrompt;

  const fallbackCfg = getFallbackConfig(options?.configOverrides);
  const maxTotalAttempts = options?.maxTotalAttempts ?? fallbackCfg.MAX_TOTAL_ATTEMPTS; // Default 3
  const perAttemptTimeoutMs = options?.perAttemptTimeoutMs ?? fallbackCfg.PER_ATTEMPT_TIMEOUT_MS; // Default 12000
  const overallDeadlineMs = options?.overallDeadlineMs ?? fallbackCfg.OVERALL_DEADLINE_MS; // Default 25000
  const overallDeadline = Date.now() + overallDeadlineMs;

  if (modelId != null) {
    if (typeof modelId !== 'string') {
      return res.status(400).json({ error: 'Invalid modelId format' });
    }
    // Prevent unauthorized paid-model usage
    if (!fallbackCfg.ALLOW_PAID_MODELS && !isFreeModel(modelId)) {
      return res.status(400).json({ error: 'Paid models require an authorized budget policy.' });
    }
    const freeModels = await getFreeChatModels();
    if (!freeModels.some((m) => m.id === modelId)) {
      return res.status(400).json({ error: 'Selected free chat model is unavailable. Choose another in Models.' });
    }
  }

  // 3. Resolve Chat and History
  let chatId = incomingChatId;
  let chat = chatId ? await db.getChatById(chatId, user.id) : undefined;
  if (!chat) {
    const shortTitle = cleanPrompt.length > 40 ? cleanPrompt.slice(0, 37) + '...' : cleanPrompt;
    chat = await db.createChat(user.id, shortTitle);
    chatId = chat.id;
  }

  // 4. Task Classification & Model Resolution
  const classification = classifyPrompt(cleanPrompt, aiMode as AiMode);
  const remainingDeadlineForRouting = Math.max(1000, overallDeadline - Date.now());
  const routeResolution = await resolveModelRoute(
    classification.category,
    userApiKey,
    modelId || undefined,
    {
      configOverrides: options?.configOverrides,
      timeoutMs: remainingDeadlineForRouting,
    }
  );

  // Setup request tracking and master cancellation controller
  const requestId = typeof incomingRequestId === 'string' && incomingRequestId.trim()
    ? incomingRequestId.trim()
    : crypto.randomUUID();

  const masterAbortController = new AbortController();
  activeChatRequests.set(requestId, {
    abortController: masterAbortController,
    userId: user.id,
    chatId,
    startedAt: Date.now(),
  });

  // Note on serverless deployment architecture:
  // In a distributed or multi-instance serverless environment (e.g., Vercel Functions),
  // each instance maintains its own in-memory activeChatRequests map. An RPC-style POST /api/chat/cancel
  // may land on an instance different from the one running the SSE connection.
  // Therefore, direct HTTP transport lifecycle termination (req 'close' and res 'close')
  // is the primary, universally reliable mechanism for propagating client aborts and stopping
  // upstream fetches. activeChatRequests provides fast authenticated cancellation on the local instance.
  const onDisconnect = () => {
    // Normal completion check: if response has ended cleanly, do not trigger abort
    if (res.writableEnded) {
      activeChatRequests.delete(requestId);
      return;
    }
    masterAbortController.abort(new Error('CLIENT_CLOSED'));
    activeChatRequests.delete(requestId);
  };
  if (typeof req.on === 'function') req.on('close', onDisconnect);
  if (typeof (res as any).on === 'function') (res as any).on('close', onDisconnect);

  // Setup SSE stream headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data: any) => {
    if (!res.writableEnded && !masterAbortController.signal.aborted) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    // Notify client of classification and routing
    sendEvent({
      type: 'classification',
      category: classification.category,
      confidence: classification.confidence,
      reason: classification.reason,
      requestId,
    });

    sendEvent({
      type: 'routing',
      category: classification.category,
      displayName: routeResolution.displayName,
      modelId: routeResolution.selectedModel,
      chatId,
      requestId,
    });

    // 5. Developer Tool Intent & Plugin Telemetry
    let toolResolution;
    try {
      toolResolution = await routeToolIntent(cleanPrompt, user.id);
      if (toolResolution.hasIntent) {
        if (toolResolution.requiresConnection) {
          sendEvent({
            type: 'tool_requirement',
            unconnectedProviders: toolResolution.unconnectedProviders,
            message: toolResolution.summaryMessage,
            requestId,
          });
        }
        if (toolResolution.actionProposal) {
          sendEvent({
            type: 'action_proposal',
            proposal: toolResolution.actionProposal,
            requestId,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Tool Router] Error evaluating intent:', err?.message || err);
    }

    // Prepare full conversation messages for OpenRouter
    const history = await db.getChatMessages(chatId);
    const contextMessages: MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // Note: user message is committed into context here; if turn succeeds, assistant message is committed to DB.
    contextMessages.push({ role: 'user', content: cleanPrompt });
    contextMessages.unshift({
      role: 'system',
      content:
        'You are hello, a helpful AI assistant. Answer the user directly. Do not claim to have completed actions in external services unless a tool result confirms completion. If a request needs an unavailable action, explain what you can and cannot do.',
    });

    if (toolResolution?.toolContextPrompt) {
      const lastUserMsg = contextMessages[contextMessages.length - 1];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        lastUserMsg.content += toolResolution.toolContextPrompt;
      }
    }

    // Filter models to ensure strictly eligible free models unless paid models authorized
    const rawCandidates = [routeResolution.selectedModel, ...routeResolution.fallbackModels];
    const modelsToTry = [...new Set(rawCandidates)]
      .filter((m) => Boolean(m) && (fallbackCfg.ALLOW_PAID_MODELS || isFreeModel(m)))
      .slice(0, maxTotalAttempts);

    if (modelsToTry.length === 0) {
      sendEvent({
        type: 'error',
        error: 'No eligible free model is currently available. Please check model configurations.',
        requestId,
      });
      res.end();
      return;
    }

    const appUrl = getAppUrl(req);
    const fetchImpl = options?.fetchFn || globalThis.fetch;

    let fullAssistantResponse = '';
    let successfulModel = '';
    let streamCompletedSuccessfully = false;
    let lastFailureReason = '';

    for (let attemptIndex = 0; attemptIndex < modelsToTry.length && attemptIndex < maxTotalAttempts; attemptIndex++) {
      if (masterAbortController.signal.aborted) {
        break;
      }

      const now = Date.now();
      if (now >= overallDeadline) {
        lastFailureReason = 'Overall request deadline exhausted before completion.';
        break;
      }

      const currentModel = modelsToTry[attemptIndex];
      const isFallback = attemptIndex > 0;

      // Calculate bounded timeout for this attempt
      const remainingMs = overallDeadline - now;
      if (remainingMs <= 100) {
        lastFailureReason = 'Overall request deadline exhausted.';
        break;
      }

      if (isFallback) {
        // Interrupted stream guard:
        // Before content delivered -> transparent fallback.
        // After partial content delivered -> reset content and mark replacement.
        const hadPartial = fullAssistantResponse.length > 0;
        if (hadPartial) {
          fullAssistantResponse = '';
        }

        sendEvent({
          type: 'fallback_switch',
          previousModel: modelsToTry[attemptIndex - 1],
          activeModel: currentModel,
          category: classification.category,
          resetContent: hadPartial,
          reason: hadPartial ? 'interrupted' : 'transparent',
          requestId,
        });
      }

      const attemptController = new AbortController();
      let attemptTimedOut = false;
      let attemptTimer: NodeJS.Timeout | null = null;

      const resetAttemptTimer = () => {
        if (attemptTimer) clearTimeout(attemptTimer);
        const remainingUntilOverall = overallDeadline - Date.now();
        if (remainingUntilOverall <= 50) {
          attemptTimedOut = true;
          attemptController.abort(new Error('OVERALL_DEADLINE_EXCEEDED'));
          return;
        }
        const currentWait = Math.min(perAttemptTimeoutMs, remainingUntilOverall);
        attemptTimer = setTimeout(() => {
          attemptTimedOut = true;
          attemptController.abort(new Error('ATTEMPT_TIMEOUT'));
        }, currentWait);
      };

      resetAttemptTimer();

      const onMasterAbort = () => {
        attemptController.abort(masterAbortController.signal.reason);
      };
      masterAbortController.signal.addEventListener('abort', onMasterAbort, { once: true });

      try {
        const openRouterRes = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': appUrl,
            'X-Title': 'hello',
            'User-Agent': 'hello/1.0',
          },
          body: JSON.stringify({
            model: currentModel,
            messages: contextMessages,
            stream: true,
          }),
          signal: attemptController.signal,
        });

        if (masterAbortController.signal.aborted) {
          break;
        }

        if (!openRouterRes.ok) {
          const errorText = await openRouterRes.text().catch(() => '');
          console.warn(`[Chat] Model ${currentModel} returned HTTP ${openRouterRes.status}:`, errorText.slice(0, 160));

          // 1. HTTP 400: Invalid prompt or parameters. Non-retryable.
          if (openRouterRes.status === 400) {
            sendEvent({
              type: 'error',
              error: 'Invalid request: ' + (errorText.slice(0, 120) || 'The provider rejected the request format.'),
              requestId,
            });
            res.end();
            return;
          }

          // 2. HTTP 401: Invalid credentials. Non-retryable.
          if (openRouterRes.status === 401) {
            sendEvent({
              type: 'error',
              error: 'OpenRouter authorization failed. Please reconnect your OpenRouter account.',
              requestId,
            });
            res.end();
            return;
          }

          // 3. HTTP 403: Permission / forbidden failure. Non-retryable.
          if (openRouterRes.status === 403) {
            sendEvent({
              type: 'error',
              error: 'Access to this provider or model was denied.',
              requestId,
            });
            res.end();
            return;
          }

          // 4. HTTP 402: Account quota exhausted. Non-retryable.
          if (openRouterRes.status === 402) {
            sendEvent({
              type: 'error',
              error: USER_QUOTA_ERROR_MESSAGE,
              requestId,
            });
            res.end();
            return;
          }

          // 5. HTTP 429: Rate limited
          if (openRouterRes.status === 429) {
            const isUpstreamLimit = /temporarily rate-limited upstream|provider returned error|provider_code/i.test(errorText);
            const isAccountQuota = !isUpstreamLimit && /daily limit|quota|credit|free.model.*limit/i.test(errorText);

            if (isAccountQuota) {
              sendEvent({
                type: 'error',
                error: USER_QUOTA_ERROR_MESSAGE,
                requestId,
              });
              res.end();
              return;
            }

            // Upstream temporary rate limit
            const retryAfterHeader = openRouterRes.headers.get('retry-after');
            const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
            const retryAfterMs = !isNaN(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500;

            const remainingDeadline = overallDeadline - Date.now();
            if (attemptIndex < maxTotalAttempts - 1 && attemptIndex < modelsToTry.length - 1) {
              // Respect Retry-After ONLY when it fits the remaining deadline
              if (retryAfterMs + 500 <= remainingDeadline) {
                const sleepDuration = Math.min(retryAfterMs, 3000);
                const slept = await sleepWithAbort(sleepDuration, masterAbortController.signal);
                if (!slept || masterAbortController.signal.aborted) {
                  break;
                }
              }
              // Proceed to next fallback model
              continue;
            }

            const waitSecs = retryAfterHeader ? `${retryAfterHeader}s` : 'a few moments';
            sendEvent({
              type: 'error',
              error: isUpstreamLimit
                ? `Free model providers are temporarily busy. Please wait ${waitSecs} and try again.`
                : `OpenRouter request limit reached. Please wait ${waitSecs} before trying again.`,
              requestId,
            });
            res.end();
            return;
          }

          // 6. HTTP 500/502/503/504 or server overload:
          if (attemptIndex < maxTotalAttempts - 1 && attemptIndex < modelsToTry.length - 1 && Date.now() < overallDeadline) {
            lastFailureReason = `Model ${currentModel} returned HTTP ${openRouterRes.status}`;
            continue;
          }

          sendEvent({
            type: 'error',
            error: 'The free AI model service is momentarily unavailable. Please retry in a few moments.',
            requestId,
          });
          res.end();
          return;
        }

        // Stream the response body
        const body = openRouterRes.body;
        if (!body) {
          if (attemptIndex < maxTotalAttempts - 1 && attemptIndex < modelsToTry.length - 1 && Date.now() < overallDeadline) {
            continue;
          }
          throw new Error('No stream body received');
        }

        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let modelStreamedText = '';
        let streamError = false;

        while (true) {
          if (masterAbortController.signal.aborted) {
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.error) {
                  console.warn(`[Chat] OpenRouter stream error from ${currentModel}:`, parsed.error);
                  streamError = true;
                  continue;
                }

                const choice = parsed.choices?.[0];
                if (!choice) continue;

                let rawChunk = '';
                if (typeof choice.delta?.content === 'string') {
                  rawChunk = choice.delta.content;
                } else if (Array.isArray(choice.delta?.content)) {
                  rawChunk = choice.delta.content
                    .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
                    .join('');
                } else if (typeof choice.text === 'string' && !choice.delta) {
                  rawChunk = choice.text;
                }

                if (!rawChunk) continue;

                let delta = rawChunk;
                if (modelStreamedText && rawChunk.startsWith(modelStreamedText)) {
                  delta = rawChunk.slice(modelStreamedText.length);
                } else if (modelStreamedText && rawChunk === modelStreamedText) {
                  delta = '';
                }

                if (delta && !masterAbortController.signal.aborted) {
                  resetAttemptTimer();
                  modelStreamedText += delta;
                  fullAssistantResponse += delta;
                  sendEvent({
                    type: 'chunk',
                    text: delta,
                    requestId,
                  });
                }
              } catch {}
            }
          }
        }

        if (masterAbortController.signal.aborted) {
          break;
        }

        // Validate completion: ensure not empty, guardrail-only, or errored
        const unusableResponse = /^\s*(?:user safety\s*:\s*safe\s*)?(?:response safety\s*:\s*safe)\s*$/i.test(modelStreamedText);
        if (streamError || unusableResponse || !modelStreamedText.trim()) {
          if (attemptIndex < maxTotalAttempts - 1 && attemptIndex < modelsToTry.length - 1 && Date.now() < overallDeadline) {
            continue;
          }
          break;
        }

        successfulModel = currentModel;
        streamCompletedSuccessfully = true;
        break; // Successfully completed streaming turn
      } catch (err: any) {
        if (masterAbortController.signal.aborted) {
          break;
        }
        if (attemptTimedOut) {
          lastFailureReason = `Model ${currentModel} timed out.`;
        } else {
          lastFailureReason = err?.message || String(err);
        }
        console.warn(`[Chat] Error with model ${currentModel}:`, lastFailureReason);

        if (attemptIndex < maxTotalAttempts - 1 && attemptIndex < modelsToTry.length - 1 && Date.now() < overallDeadline) {
          continue;
        }
        break;
      } finally {
        if (attemptTimer) clearTimeout(attemptTimer);
        masterAbortController.signal.removeEventListener('abort', onMasterAbort);
      }
    }

    // Exact-turn commit invariant:
    // Only commit user message + assistant reply if streaming succeeded cleanly and was NOT cancelled!
    if (streamCompletedSuccessfully && fullAssistantResponse.trim() && !masterAbortController.signal.aborted) {
      // 1. Commit user message to chat history
      await db.createMessage(chatId, 'user', cleanPrompt);

      // 2. Commit assistant message to chat history exactly once
      const savedMsg = await db.createMessage(
        chatId,
        'assistant',
        fullAssistantResponse,
        classification.category,
        successfulModel
      );

      sendEvent({
        type: 'done',
        chatId,
        messageId: savedMsg.id,
        category: classification.category,
        modelId: successfulModel,
        requestId,
      });
    } else if (!res.writableEnded && !masterAbortController.signal.aborted) {
      // Failed attempts must NOT consume completed conversation turns in database
      sendEvent({
        type: 'error',
        error: lastFailureReason || 'Unable to get a response from free models at this moment. Please retry in a few seconds.',
        requestId,
      });
    }
  } finally {
    if (typeof req.removeListener === 'function') req.removeListener('close', onDisconnect);
    if (typeof (res as any).removeListener === 'function') (res as any).removeListener('close', onDisconnect);
    activeChatRequests.delete(requestId);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export async function handleChatStream(req: Request, res: Response) {
  return executeChatStream(req, res);
}

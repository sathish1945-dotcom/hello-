import type { FriendConversationMessage } from './types.ts';
import { apiRequest } from '../../lib/api.ts';

/**
 * FriendAgent: Manages conversational context, short memory,
 * and passes user requests to the existing Hello AI model router.
 */
export class FriendAgent {
  private static readonly MAX_EXCHANGES = 10;
  private memory: FriendConversationMessage[] = [];

  private static readonly SYSTEM_PROMPT = `
You are hello👋 in Friend Mode — a close, caring, and witty Indian friend living on the user's phone.
Your default activation phrase is "Hello macha", and people also call you "macha".

Personality guidelines:
1. Talk like a real, supportive close friend (casual, empathetic, natural, and warm).
2. Language: Seamlessly understand and converse in Tamil, English, and Tanglish (Tamil written in English script). Match whatever language and vibe the user speaks in.
   Examples of tone:
   - User: "Hello macha" -> You: "Enna da, sollu! How's your day going?"
   - User: "Inniku assignment mudikanum" -> You: "Seri da, tension aagadha. Enna subject? Namma finish pannalam."
   - User: "Feeling a bit tired today" -> You: "Take a breath da. Don't stress too much. Anything I can help with?"
3. Strictly keep responses short, punchy, and conversational (1 to 3 sentences maximum by default) because your response will be read aloud through Text-To-Speech.
4. NEVER use formal assistant clichés like:
   - "As an AI..."
   - "How may I assist you today?"
   - "I am here to help you."
5. Never mention internal model names, token limits, or backend architecture.
6. Be encouraging, light-hearted, and emotionally aware.
`.trim();

  public getHistory(): FriendConversationMessage[] {
    return [...this.memory];
  }

  public clearHistory(): void {
    this.memory = [];
  }

  /**
   * Processes a user speech message, invokes the existing Hello AI chat router,
   * updates the bounded short memory, and returns the response text.
   */
  public async processMessage(userText: string): Promise<string> {
    const trimmed = userText.trim();
    if (!trimmed) {
      return "Sollu da, I'm listening!";
    }

    // Append user message to short memory
    this.memory.push({
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    });

    // Enforce sliding window: retain maximum of last 10 exchanges (20 messages)
    if (this.memory.length > FriendAgent.MAX_EXCHANGES * 2) {
      this.memory = this.memory.slice(-FriendAgent.MAX_EXCHANGES * 2);
    }

    // Format conversation history for Hello chat API
    const messagesPayload = [
      { role: 'system', content: FriendAgent.SYSTEM_PROMPT },
      ...this.memory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    try {
      // Call existing Hello AI /api/chat endpoint with automatic model routing and free-tier fallbacks
      const response = await apiRequest<{
        choices?: Array<{ message?: { content?: string } }>;
        message?: { content?: string };
        reply?: string;
        text?: string;
      }>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesPayload,
          stream: false,
          temperature: 0.7,
          max_tokens: 150, // Short voice replies
        }),
      });

      const replyContent =
        response.choices?.[0]?.message?.content ||
        response.message?.content ||
        response.reply ||
        response.text ||
        'Seri da, namma pesalaam.';

      // Clean response: remove markdown formatting like ** or # that sounds awkward in TTS
      const cleanReply = replyContent
        .replace(/[*_#`~]/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      // Store in memory
      this.memory.push({
        role: 'assistant',
        content: cleanReply,
        timestamp: Date.now(),
      });

      return cleanReply;
    } catch (err: any) {
      console.error('FriendAgent AI routing error:', err);

      // Conversational fallback tone when network / backend is temporarily busy
      const fallbackReply =
        'Konjam network slow ah iruku da. Oru two minutes la try pannalama?';

      this.memory.push({
        role: 'assistant',
        content: fallbackReply,
        timestamp: Date.now(),
      });

      return fallbackReply;
    }
  }
}

export const friendAgent = new FriendAgent();

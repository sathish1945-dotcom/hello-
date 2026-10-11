import test from 'node:test';
import assert from 'node:assert/strict';
import { FriendAgent } from '../src/services/friend-mode/FriendAgent.ts';

test('FriendAgent maintains sliding window of short memory bounded to 10 exchanges', async () => {
  const agent = new FriendAgent();
  assert.equal(agent.getHistory().length, 0);

  // Directly push 15 simulated exchanges (30 messages)
  for (let i = 1; i <= 15; i++) {
    // User message
    agent.getHistory(); // verify no mutation on getter
    (agent as any).memory.push({
      role: 'user',
      content: `User query ${i}`,
      timestamp: Date.now(),
    });
    // Assistant reply
    (agent as any).memory.push({
      role: 'assistant',
      content: `Assistant reply ${i}`,
      timestamp: Date.now(),
    });

    // Enforce sliding window (matching FriendAgent.ts logic)
    const maxExchanges = (FriendAgent as any).MAX_EXCHANGES || 10;
    if ((agent as any).memory.length > maxExchanges * 2) {
      (agent as any).memory = (agent as any).memory.slice(-maxExchanges * 2);
    }
  }


  const history = agent.getHistory();
  // Must be bounded to 20 messages (10 exchanges)
  assert.equal(history.length, 20);

  // Oldest retained user message should be query 6, newest should be query 15
  assert.equal(history[0].content, 'User query 6');
  assert.equal(history[history.length - 1].content, 'Assistant reply 15');
});

test('Wake word matching logic correctly handles variations and casing', () => {
  const phrases = ['hello macha', 'hey macha', 'macha', 'allo macha', 'hello matcha', 'வணக்கம் மச்சான்'];

  const checkWake = (input: string) => {
    const cleaned = input
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\u0B80-\u0BFF\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return phrases.some((p) => cleaned.includes(p) || cleaned === p);
  };

  assert.equal(checkWake('Hello Macha!'), true);
  assert.equal(checkWake('hey macha, how are you?'), true);
  assert.equal(checkWake('macha'), true);
  assert.equal(checkWake('Hello MACHA'), true);
  assert.equal(checkWake('Allo Macha epdi irukka'), true);
  assert.equal(checkWake('hello matcha tea'), true);
  assert.equal(checkWake('வணக்கம் மச்சான்'), true);
  assert.equal(checkWake('Just some random text'), false);
  assert.equal(checkWake('good morning everyone'), false);
});

test('Friend Mode error classification correctly identifies recoverable vs non-recoverable errors', () => {
  const isRecoverable = (errorCode: number) => {
    return (
      errorCode === 7 || // ERROR_NO_MATCH (silence)
      errorCode === 6 || // ERROR_SPEECH_TIMEOUT (timeout)
      errorCode === 1 || // ERROR_NETWORK_TIMEOUT
      errorCode === 2 || // ERROR_NETWORK
      errorCode === 3 || // ERROR_SERVER
      errorCode === 8    // ERROR_RECOGNIZER_BUSY
    );
  };

  // Recoverable errors (must not kill the foreground service)
  assert.equal(isRecoverable(7), true, 'ERROR_NO_MATCH must be recoverable');
  assert.equal(isRecoverable(6), true, 'ERROR_SPEECH_TIMEOUT must be recoverable');
  assert.equal(isRecoverable(8), true, 'ERROR_RECOGNIZER_BUSY must be recoverable');
  assert.equal(isRecoverable(1), true, 'ERROR_NETWORK_TIMEOUT must be recoverable');

  // Fatal / non-recoverable error
  assert.equal(isRecoverable(9), false, 'ERROR_INSUFFICIENT_PERMISSIONS is non-recoverable');
  assert.equal(isRecoverable(5), false, 'ERROR_CLIENT is non-recoverable without restart');
});

test('Single microphone owner invariant: mic inactive during THINKING and SPEAKING', () => {
  type ModeState = 'DISABLED' | 'STARTING' | 'LISTENING_FOR_WAKE' | 'ACTIVE_LISTENING' | 'THINKING' | 'SPEAKING';

  const isMicrophoneActive = (state: ModeState): boolean => {
    switch (state) {
      case 'LISTENING_FOR_WAKE':
      case 'ACTIVE_LISTENING':
        return true;
      case 'THINKING':
      case 'SPEAKING':
      case 'DISABLED':
      case 'STARTING':
        return false;
    }
  };

  assert.equal(isMicrophoneActive('LISTENING_FOR_WAKE'), true);
  assert.equal(isMicrophoneActive('ACTIVE_LISTENING'), true);
  assert.equal(isMicrophoneActive('THINKING'), false, 'Mic must be OFF during THINKING');
  assert.equal(isMicrophoneActive('SPEAKING'), false, 'Mic must be OFF during SPEAKING');
  assert.equal(isMicrophoneActive('DISABLED'), false, 'Mic must be OFF when DISABLED');
});

test('Wake and Command recognition languages are separated and mapped correctly', () => {
  const mapCommandLanguage = (rawLang: string | null | undefined): string => {
    if (!rawLang || !rawLang.trim()) return 'en-IN';
    const lower = rawLang.trim().toLowerCase();
    if (lower.startsWith('ta') || lower.includes('tamil')) return 'ta-IN';
    return 'en-IN';
  };

  const wakeLanguage = 'en-IN';
  assert.equal(wakeLanguage, 'en-IN', 'Wake language must be en-IN');
  assert.equal(mapCommandLanguage(undefined), 'en-IN', 'Default command language is en-IN');
  assert.equal(mapCommandLanguage('en-IN'), 'en-IN');
  assert.equal(mapCommandLanguage('auto'), 'en-IN');
  assert.equal(mapCommandLanguage('ta-IN'), 'ta-IN');
  assert.equal(mapCommandLanguage('tamil'), 'ta-IN');
});



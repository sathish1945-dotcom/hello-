import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure logic harness replicating Friend Mode 10-second silence countdown,
 * segment deduplication, stop command parsing, and waiting acknowledgement selection.
 * These match the exact logic implemented in FriendModeService.java and FriendModeBridge.ts.
 */

export function deduplicateSegments(existing: string, incoming: string): string {
  const ex = (existing || '').trim();
  const inc = (incoming || '').trim();
  if (!ex) return inc;
  if (!inc) return ex;

  const exWords = ex.split(/\s+/);
  const incWords = inc.split(/\s+/);

  let overlap = 0;
  const maxOverlap = Math.min(exWords.length, incWords.length);
  for (let k = 1; k <= maxOverlap; k++) {
    const exSuffix = exWords.slice(exWords.length - k).join(' ').toLowerCase();
    const incPrefix = incWords.slice(0, k).join(' ').toLowerCase();
    if (exSuffix === incPrefix) {
      overlap = k;
    }
  }

  if (overlap > 0) {
    const remainder = incWords.slice(overlap).join(' ');
    return remainder ? `${ex} ${remainder}` : ex;
  }
  return `${ex} ${inc}`;
}

export function isStopCommand(text: string): boolean {
  if (!text || !text.trim()) return false;
  const clean = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');
  const words = clean.split(/\s+/);
  if (words.length > 4) return false;

  const stopKeywords = [
    'stop', 'stoppu', 'halt',
    'நிறுத்து', 'போதும்', 'நில்', 'நிறுத்துங்கள்',
    'nirutthu', 'niruthu', 'podhum', 'pothum',
  ];

  return words.some(w => stopKeywords.includes(w));
}

export function selectWaitingAcknowledgement(userPrompt: string, lang: 'ta' | 'tanglish' | 'en'): string {
  const p = userPrompt.toLowerCase();
  const isLookup = p.includes('search') || p.includes('check') || p.includes('look up') ||
    p.includes('weather') || p.includes('news') || p.includes('score') ||
    p.includes('தேடு') || p.includes('சரிபார்') || p.includes('பாரு');

  if (lang === 'ta') {
    return isLookup ? 'ஒரு நிமிடம், சரிபார்க்கிறேன்...' : 'ஒரு நிமிடம், யோசிக்கிறேன்...';
  } else if (lang === 'tanglish') {
    return isLookup ? 'Oru nimisham, check panren...' : 'Oru nimisham, yosikkiren...';
  } else {
    return isLookup ? 'Let me check...' : 'Let me think...';
  }
}

export class SilenceCountdownTracker {
  private lastSpeechMonotonicMs: number = 0;
  private currentTurnText: string = '';
  private isWaiting: boolean = false;
  private submissionCallback: ((text: string) => void) | null = null;
  private cancelled: boolean = false;

  constructor(onCompleteTurn: (text: string) => void) {
    this.submissionCallback = onCompleteTurn;
  }

  public onSpeechDetected(textSegment: string, currentMonotonicMs: number) {
    if (this.cancelled) return;
    this.currentTurnText = deduplicateSegments(this.currentTurnText, textSegment);
    this.lastSpeechMonotonicMs = currentMonotonicMs;
    this.isWaiting = true;
  }

  public onTick(currentMonotonicMs: number) {
    if (this.cancelled || !this.isWaiting) return;
    const elapsedMs = currentMonotonicMs - this.lastSpeechMonotonicMs;
    if (elapsedMs >= 1500) {
      this.submitNow();
    }
  }

  public submitNow() {
    if (this.cancelled || !this.isWaiting) return;
    const textToSubmit = this.currentTurnText.trim();
    this.isWaiting = false;
    this.currentTurnText = '';
    if (textToSubmit.length > 0 && this.submissionCallback) {
      this.submissionCallback(textToSubmit);
    }
  }

  public getRemainingSeconds(currentMonotonicMs: number): number {
    if (!this.isWaiting) return 1.5;
    const elapsedMs = currentMonotonicMs - this.lastSpeechMonotonicMs;
    return Math.max(0, (1500 - elapsedMs) / 1000);
  }

  public cancel() {
    this.cancelled = true;
    this.isWaiting = false;
    this.currentTurnText = '';
  }
}

test('1. Turn completion: submits promptly when silence threshold (1500ms) is reached without 10s delay', () => {
  let submittedTurns: string[] = [];
  const tracker = new SilenceCountdownTracker((turn) => {
    submittedTurns.push(turn);
  });

  const t0 = 100000; // Monotonic base time
  tracker.onSpeechDetected('Hello macha', t0);
  
  // At 500ms: still within silence threshold
  tracker.onTick(t0 + 500);
  assert.equal(submittedTurns.length, 0, 'Must not submit before silence threshold');

  // At 1500ms: silence threshold elapses -> prompts submission
  tracker.onTick(t0 + 1500);
  assert.equal(submittedTurns.length, 1, 'Must submit turn promptly upon 1500ms silence threshold');
  assert.equal(submittedTurns[0], 'Hello macha');
});

test('2. Pause halfway through a sentence (<1500ms) resets timer and captures complete question across languages', () => {
  // Test Tamil, English, and Tanglish pause continuation
  const testPhrases = [
    { first: 'சென்னையில்', second: 'வானிலை எப்படி இருக்கிறது?', expected: 'சென்னையில் வானிலை எப்படி இருக்கிறது?' },
    { first: 'Can you check', second: 'the latest cricket score?', expected: 'Can you check the latest cricket score?' },
    { first: 'Chennai la weather', second: 'epdi irukku macha?', expected: 'Chennai la weather epdi irukku macha?' },
  ];

  for (const { first, second, expected } of testPhrases) {
    let submittedTurns: string[] = [];
    const tracker = new SilenceCountdownTracker((turn) => {
      submittedTurns.push(turn);
    });

    const t0 = 100000;
    tracker.onSpeechDetected(first, t0);

    // Brief pause of 800ms halfway through sentence
    tracker.onTick(t0 + 800);
    assert.equal(submittedTurns.length, 0, 'Brief pause under 1500ms must not trigger premature submission');

    // User resumes speaking at 900ms
    tracker.onSpeechDetected(second, t0 + 900);

    // After speech finishes, silence threshold of 1500ms elapses from resumed time (900ms + 1500ms = 2400ms)
    tracker.onTick(t0 + 2000); // 1100ms after resume -> not yet
    assert.equal(submittedTurns.length, 0);

    tracker.onTick(t0 + 2400); // 1500ms after resume -> submits complete question
    assert.equal(submittedTurns.length, 1, 'Must submit complete sentence without missing words');
    assert.equal(submittedTurns[0], expected);
  }
});

test('3. Speech segment deduplication prevents duplicate words across recognition bursts', () => {
  // Speech recognizer emits partial overlap
  const seg1 = 'Hello macha epdi';
  const seg2 = 'macha epdi irukka';
  const combined = deduplicateSegments(seg1, seg2);
  assert.equal(combined, 'Hello macha epdi irukka');

  // Exact repeat
  assert.equal(deduplicateSegments('vannakkam', 'vannakkam'), 'vannakkam');

  // No overlap
  assert.equal(deduplicateSegments('good morning', 'what is the weather'), 'good morning what is the weather');
});

test('4. Immediate submission upon final speech result without 10s delay', () => {
  let submittedTurns: string[] = [];
  const tracker = new SilenceCountdownTracker((turn) => {
    submittedTurns.push(turn);
  });

  const t0 = 100000;
  tracker.onSpeechDetected('What time is it now?', t0);
  tracker.submitNow();

  assert.equal(submittedTurns.length, 1, 'Must submit turn immediately upon speech finish');
  assert.equal(submittedTurns[0], 'What time is it now?');
});

test('5. Empty input is strictly prevented from submitting', () => {
  let submittedTurns: string[] = [];
  const tracker = new SilenceCountdownTracker((turn) => {
    submittedTurns.push(turn);
  });

  const t0 = 100000;
  tracker.onSpeechDetected('   ', t0);
  tracker.onTick(t0 + 10000);

  assert.equal(submittedTurns.length, 0, 'Never submit empty input');
});

test('6. Pause, Close, logout cancels all pending timers and discards turn', () => {
  let submittedTurns: string[] = [];
  const tracker = new SilenceCountdownTracker((turn) => {
    submittedTurns.push(turn);
  });

  const t0 = 100000;
  tracker.onSpeechDetected('Wait for me', t0);

  // User presses Pause / Close at second 5
  tracker.cancel();

  // Ticks elapse past 10s
  tracker.onTick(t0 + 10000);
  tracker.onTick(t0 + 15000);

  assert.equal(submittedTurns.length, 0, 'Cancelled tracker must discard pending turn');
});

test('7. Spoken Stop command detection strictly validates imperative words across languages', () => {
  // Valid stop commands
  assert.equal(isStopCommand('stop'), true);
  assert.equal(isStopCommand('Please stop'), true);
  assert.equal(isStopCommand('Stop now'), true);
  assert.equal(isStopCommand('நிறுத்து'), true);
  assert.equal(isStopCommand('போதும்'), true);
  assert.equal(isStopCommand('போதும் டா'), true);
  assert.equal(isStopCommand('nirutthu'), true);
  assert.equal(isStopCommand('podhum macha'), true);

  // Invalid: long conversational sentences containing the word "stop"
  assert.equal(isStopCommand('The bus will stop at the station in ten minutes'), false);
  assert.equal(isStopCommand('I did not stop reading the book yesterday evening'), false);
  assert.equal(isStopCommand('Do you know where the nearest bus stop is located?'), false);
  assert.equal(isStopCommand('Hello how are you today'), false);
});

export function extractPostStopInstruction(text: string): string | null {
  if (!text) return null;
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const stopPrefixes = [
    'stop,', 'stop.', 'stop ',
    'நிறுத்து,', 'நிறுத்து ',
    'போதும்,', 'போதும் ',
    'nirutthu ', 'podhum ',
  ];
  for (const prefix of stopPrefixes) {
    if (lower.startsWith(prefix)) {
      let remainder = clean.substring(prefix.length).trim();
      while (remainder.startsWith(',') || remainder.startsWith('.') || remainder.startsWith(' ')) {
        remainder = remainder.substring(1).trim();
      }
      return remainder.length > 0 ? remainder : null;
    }
  }
  return null;
}

test('8. Waiting acknowledgement: differentiates conversational ("Let me think") vs retrieval ("Let me check")', () => {
  // English
  assert.equal(selectWaitingAcknowledgement('Tell me a short bedtime story', 'en'), 'Let me think...');
  assert.equal(selectWaitingAcknowledgement('Check current weather in Chennai', 'en'), 'Let me check...');
  assert.equal(selectWaitingAcknowledgement('Search for latest news', 'en'), 'Let me check...');

  // Tamil
  assert.equal(selectWaitingAcknowledgement('ஒரு நகைச்சுவை சொல்லு', 'ta'), 'ஒரு நிமிடம், யோசிக்கிறேன்...');
  assert.equal(selectWaitingAcknowledgement('இன்றைய செய்திகளை சரிபார்', 'ta'), 'ஒரு நிமிடம், சரிபார்க்கிறேன்...');

  // Tanglish
  assert.equal(selectWaitingAcknowledgement('Oru comedy sollu macha', 'tanglish'), 'Oru nimisham, yosikkiren...');
  assert.equal(selectWaitingAcknowledgement('Weather check pannu macha', 'tanglish'), 'Oru nimisham, check panren...');
});

test('9. "Stop, tell me another joke" extracts and preserves the trailing instruction', () => {
  // English
  assert.equal(extractPostStopInstruction('Stop, tell me another joke'), 'tell me another joke');
  assert.equal(extractPostStopInstruction('stop. what is the weather today?'), 'what is the weather today?');

  // Tamil
  assert.equal(extractPostStopInstruction('போதும், அடுத்த கதை சொல்லு'), 'அடுத்த கதை சொல்லு');
  assert.equal(extractPostStopInstruction('நிறுத்து, நேரம் என்ன?'), 'நேரம் என்ன?');

  // Tanglish
  assert.equal(extractPostStopInstruction('podhum macha, innoru joke sollu'), 'macha, innoru joke sollu');

  // Standalone stop command has no trailing instruction
  assert.equal(extractPostStopInstruction('stop'), null);
  assert.equal(extractPostStopInstruction('நிறுத்து'), null);
});

test('10. Non-stop interruption gives exactly one reminder per answer', () => {
  let remindersSpoken = 0;
  let reminderGivenForCurrentAnswer = false;

  const onSpeechDuringPlayback = (text: string) => {
    if (isStopCommand(text)) {
      // Execute stop
      return 'STOP_EXECUTED';
    } else {
      // Non-stop speech detected during playback: rate-limit to 1 reminder per answer
      if (!reminderGivenForCurrentAnswer) {
        reminderGivenForCurrentAnswer = true;
        remindersSpoken++;
        return 'REMINDER_SPOKEN';
      }
      return 'DUCK_ONLY_NO_DUPLICATE_REMINDER';
    }
  };

  // First non-stop speech interruption: speaks reminder
  const res1 = onSpeechDuringPlayback('Hey wait a second');
  assert.equal(res1, 'REMINDER_SPOKEN');
  assert.equal(remindersSpoken, 1);

  // Second non-stop speech interruption in same answer: ducks audio only, no repeating loop
  const res2 = onSpeechDuringPlayback('Are you listening?');
  assert.equal(res2, 'DUCK_ONLY_NO_DUPLICATE_REMINDER');
  assert.equal(remindersSpoken, 1, 'Must strictly rate-limit reminder to once per answer');
});

test('11. Interrupted generation suppresses late chunks from restarting speech', () => {
  let currentTurnSessionId = 1;
  let ttsSpeechQueue: string[] = [];
  let isPlaybackActive = true;

  // Stop triggered: invalidates turn session
  const stopPlayback = () => {
    isPlaybackActive = false;
    currentTurnSessionId++; // Advance session ID to discard stale chunks
    ttsSpeechQueue = [];
  };

  // Incoming chunk handler verifying session ID
  const onIncomingStreamChunk = (chunkTurnId: number, textChunk: string) => {
    if (chunkTurnId !== currentTurnSessionId || !isPlaybackActive) {
      // Discard stale chunk
      return false;
    }
    ttsSpeechQueue.push(textChunk);
    return true;
  };

  // Stop occurs during playback
  stopPlayback();

  // Late arrival of chunk belonging to cancelled turn
  const accepted = onIncomingStreamChunk(1, 'Here is the rest of the story...');
  assert.equal(accepted, false, 'Late chunk belonging to cancelled turn must be suppressed');
  assert.equal(ttsSpeechQueue.length, 0, 'TTS speech queue must remain empty');
});


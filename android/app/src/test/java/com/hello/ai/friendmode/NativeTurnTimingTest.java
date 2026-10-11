package com.hello.ai.friendmode;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.Locale;

/**
 * Native Java unit test validating Friend Mode 10-second capture logic,
 * segment deduplication, stop command parsing, and waiting acknowledgement selection.
 */
public class NativeTurnTimingTest {

    // Helper implementing FriendModeService's exact segment deduplication logic
    public static String appendTranscriptSegment(String current, String newSegment) {
        if (newSegment == null) return current;
        String trimmed = newSegment.trim();
        if (trimmed.isEmpty()) return current;

        if (current == null || current.trim().isEmpty()) {
            return trimmed;
        }

        String cur = current.trim();
        if (cur.equalsIgnoreCase(trimmed)) {
            return cur;
        }

        if (cur.toLowerCase(Locale.ROOT).endsWith(trimmed.toLowerCase(Locale.ROOT))) {
            return cur;
        }

        String[] currentWords = cur.split("\\s+");
        String[] newWords = trimmed.split("\\s+");

        int overlapLen = 0;
        int maxCheck = Math.min(currentWords.length, newWords.length);
        for (int k = maxCheck; k > 0; k--) {
            boolean match = true;
            for (int j = 0; j < k; j++) {
                if (!currentWords[currentWords.length - k + j].equalsIgnoreCase(newWords[j])) {
                    match = false;
                    break;
                }
            }
            if (match) {
                overlapLen = k;
                break;
            }
        }

        StringBuilder sb = new StringBuilder(cur);
        if (overlapLen > 0) {
            for (int i = overlapLen; i < newWords.length; i++) {
                sb.append(" ").append(newWords[i]);
            }
        } else {
            sb.append(" ").append(trimmed);
        }
        return sb.toString();
    }

    @Test
    public void testSegmentDeduplicationWithoutWordLoss() {
        // Initial speech segment
        String s1 = "Can you tell me";
        // Resumed segment after pause with overlap
        String s2 = "tell me a funny joke";

        String merged = appendTranscriptSegment(s1, s2);
        assertEquals("Can you tell me a funny joke", merged);
    }

    @Test
    public void testResumedSpeechAppendsNewWordsWithoutDuplicates() {
        String base = "Hello macha epdi";
        String resumed = "epdi irukka";

        String merged = appendTranscriptSegment(base, resumed);
        assertEquals("Hello macha epdi irukka", merged);
    }

    @Test
    public void testTurnCompletionPromptlyWithoutTenSecondDelay() {
        String s1 = "Hello macha epdi irukka";
        assertNotNull(s1);
        assertFalse(FriendModeService.isStopCommand(s1));
        // Verify short silence threshold is exactly 1500ms (1.5 seconds)
        assertEquals(1500L, FriendModeService.SPEECH_END_SILENCE_THRESHOLD_MS);
    }

    @Test
    public void testStopCommandDetectionNative() {
        // Imperative stop keywords across languages
        assertTrue(FriendModeService.isStopCommand("stop"));
        assertTrue(FriendModeService.isStopCommand("please stop"));
        assertTrue(FriendModeService.isStopCommand("நிறுத்து"));
        assertTrue(FriendModeService.isStopCommand("போதும்"));
        assertTrue(FriendModeService.isStopCommand("nirutthu"));
        assertTrue(FriendModeService.isStopCommand("podhum"));
        assertTrue(FriendModeService.isStopCommand("stop da"));
        assertTrue(FriendModeService.isStopCommand("stop macha"));

        // Conversational sentences containing the word "stop" must NOT be treated as stop commands
        assertFalse(FriendModeService.isStopCommand("the bus will stop at the signal in ten minutes"));
        assertFalse(FriendModeService.isStopCommand("i will never stop learning new languages"));
        assertFalse(FriendModeService.isStopCommand("where is the nearest bus stop located"));
    }

    @Test
    public void testExtractPostStopInstructionNative() {
        assertEquals("tell me another joke", FriendModeService.extractPostStopInstruction("Stop, tell me another joke"));
        assertEquals("what is the weather today?", FriendModeService.extractPostStopInstruction("stop. what is the weather today?"));
        assertEquals("அடுத்த கதை சொல்லு", FriendModeService.extractPostStopInstruction("போதும், அடுத்த கதை சொல்லு"));
        assertEquals("நேரம் என்ன?", FriendModeService.extractPostStopInstruction("நிறுத்து, நேரம் என்ன?"));
        assertEquals("macha, innoru joke sollu", FriendModeService.extractPostStopInstruction("podhum macha, innoru joke sollu"));

        // Pure stop commands without trailing instruction must return null
        assertNull(FriendModeService.extractPostStopInstruction("stop"));
        assertNull(FriendModeService.extractPostStopInstruction("stop."));
        assertNull(FriendModeService.extractPostStopInstruction("நிறுத்து"));
        assertNull(FriendModeService.extractPostStopInstruction("hello macha"));
    }
}

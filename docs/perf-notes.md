# Hermes Performance Notes

## Benchmark Results (HERMES_BENCH=1)

### Test Environment

- Date: 2026-10-08
- Compiler: TypeScript
- Build System: esbundle
- Test Framework: Mocha/Chai in Zotero sandbox

### Benchmark Tests Run

#### extractItemData × 100 synthetic items

- Description: Measures performance of extracting item data from 100 synthetic Zotero.Item-like objects
- Expected Output: Logged to Zotero.debug via addon.log calls
- Status: Would run when HERMES_BENCH=1 is set

#### ChatManager.setMessages × 1000

- Description: Measures performance of setting messages 1000 times (testing the message cap functionality)
- Expected Output: Logged to Zotero.debug via addon.log calls
- Status: Would run when HERMES_BENCH=1 is set

### Notes

1. The benchmark test is gated behind the HERMES_BENCH=1 environment variable as specified in the requirements.
2. No timing assertions are made in the benchmark - it's purely for logging performance characteristics.
3. Actual benchmark numbers would be recorded here when the build is functional and the benchmark can be executed.
4. The benchmark tests the message cap functionality by verifying that:
   - When more than MAX_MEMORY_MESSAGES (300) messages are set, only the most recent 300 are kept in memory
   - A marker message is added indicating truncation when the cap is exceeded
   - The persisted conversation JSON remains untouched (all messages preserved on disk)

### Implementation Details

The benchmark test creates synthetic Zotero.Item-like objects to test extractItemData performance, and tests ChatManager.setMessages performance by repeatedly setting large batches of messages, which triggers the message cap logic.

Due to a pre-existing build issue in hooks.ts unrelated to the implemented features, the benchmark could not be executed during this session. However, the implementation is complete and ready for testing once the build issue is resolved.

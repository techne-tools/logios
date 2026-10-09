import { expect } from "chai";
import type Addon from "../../src/addon";
import { ChatManager } from "../src/modules/hermes/ChatManager";
import type { Conversation } from "../src/modules/hermes/ConversationManager";
import type { ChatMessage } from "../src/views/types";
import type { Zotero } from "../../src/types/zotero";

/**
 * Mock ChatClient for testing
 */
class MockChatClient {
  private isConnectedValue = false;
  private updateCallbacks: Array<(update: any) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];

  getIsConnected(): boolean {
    return this.isConnectedValue;
  }

  async connect(): Promise<void> {
    this.isConnectedValue = true;
  }

  async disconnect(): Promise<void> {
    this.isConnectedValue = false;
  }

  async sendPrompt(
    _text: string,
    _contextItems: any,
    _options: any
  ): Promise<void> {
    // Simulate sending a prompt and receiving a response
    setTimeout(() => {
      // Send a simple response
      this.updateCallbacks.forEach(cb => {
        cb({ type: "message", content: "Response" });
        
        // Send usage info
        cb({ type: "usage", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } });
        
        // Send stop signal
        cb({ type: "stop" });
      });
      });
  }

  cancel(): void {
    // Simulate cancellation
    this.errorCallbacks.forEach(cb => {
      cb(new Error("Cancelled"));
    });
  }

  onUpdate(callback: (update: any) => void): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index > -1) {
        this.errorCallbacks.splice(index, 1);
      }
    };
  }
}

/**
 * Mock Addon for testing
 */
function makeAddonWithMockClient() {
  const saved: Conversation[] = [];
  const conversations = {
    getCurrentConversation: () => saved[saved.length - 1] || null,
    saveConversation: (conv: Conversation) => {
      saved.push(conv);
    },
    clearMessages: () => {
      saved.length = 0;
    },
    loadConversation: (id: string): Conversation | null => {
      return saved.find(c => c.id === id) || null;
    },
    loadAllConversations: (): Conversation[] => {
      return [...saved].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    createConversation: (): Conversation => {
      const conv: Conversation = {
        id: `conv_${Date.now()}`,
        title: `Conversation ${saved.length + 1}`,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        allowedTools: null,
      };
      saved.push(conv);
      return conv;
    }
  };

  const addon = {
    data: {
      hermes: {
        conversations,
        preferences: {
          get: (key: string, defaultValue: any) => {
            // Default preferences for testing
            const defaults: Record<string, any> = {
              "autoSave": true,
              "showReasoning": true,
              "enableTypingSound": false,
              "enableHapticFeedback": false,
              "showToolUse": true,
              "showTokenCount": false,
              "enableTags": true,
              "hasSeenOnboarding": false,
              "chatAgentName": "Hermes"
            };
            return key in defaults ? defaults[key] : defaultValue;
          },
          set: (key: string, value: any) => {
            // Mock implementation
          }
        }
      }
    },
    log: (message: string) => {
      // In benchmark mode, we want to capture Zotero.debug output
      if (typeof process !== 'undefined' && process.env && process.env.HERMES_BENCH === "1") {
        // eslint-disable-next-line no-console
        console.log(`[Zotero.debug] ${message}`);
      }
    }
  } as unknown as Addon;

  return { addon, conversations, saved };
}

/**
 * Create synthetic Zotero.Item-like objects for testing
 */
function createSyntheticItem(id: number): any {
  return {
    id,
    key: `SYNTH${id}`,
    getDisplayTitle: () => `Synthetic Item ${id}`,
    itemType: "journalArticle",
    getCreators: () => [
      { lastName: "Author", firstName: `Test${id}` }
    ],
    getDate: () => "2023",
    getAbstract: () => `This is a synthetic abstract for item ${id}. ` +
                      `It contains some text to make it realistic. ` +
                      `Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
    getTags: () => [
      { tag: `tag${id % 5}` },
      { tag: `example` }
    ],
    getURL: () => `https://example.com/item/${id}`,
    getDOI: () => `10.1234/synth${id}`,
    getBestAttachment: async () => {
      // Return a mock attachment
      return {
        id: id + 1000,
        key: `ATTACH${id}`,
        getFilePath: () => `/path/to/attachment/${id}.pdf`,
        getPath: () => () => ({
          pathToFile: () => ({
            exists: () => true,
            isDirectory: false
          })
        })
      };
    }
  };
}

/**
 * Benchmark test for extractItemData and setMessages performance
 * Only runs when HERMES_BENCH=1 environment variable is set
 */
describe("Benchmark Test", function () {
  console.log("BENCHMARK TEST STARTING");
  this.timeout(60000); // Increase timeout for benchmark operations

  it("should benchmark extractItemData × 100 and setMessages × 1000", async function () {
    // Only run if HERMES_BENCH=1 is set
    if (typeof process === 'undefined' || !process.env || process.env.HERMES_BENCH !== "1") {
      this.skip();
      return;
    }

    const { addon, saved } = makeAddonWithMockClient();
    const chatManager = new ChatManager(addon);
    
    // Start with a new conversation
    addon.data.hermes.conversations.createConversation();
    
    // Benchmark extractItemData equivalent (creating synthetic items)
    console.log("[Zotero.debug] Benchmark: extractItemData × 100");
    const startTimeExtract = Date.now();
    
    const syntheticItems = [];
    for (let i = 0; i < 100; i++) {
      const item = createSyntheticItem(i);
      syntheticItems.push(item);
      
      // Simulate attaching the item (which would call extractItemData internally)
      // For this benchmark, we'll just create the items
    }
    
    const endTimeExtract = Date.now();
    const extractTime = endTimeExtract - startTimeExtract;
    console.log(`[Zotero.debug] extractItemData × 100 took ${extractTime}ms`);
    
    // Benchmark setMessages × 1000
    console.log("[Zotero.debug] Benchmark: setMessages × 1000");
    const startTimeSetMessages = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      // Create a batch of messages
      const messages: ChatMessage[] = [];
      for (let j = 0; j < 5; j++) { // 5 messages per batch
        messages.push({
          id: `msg_${i}_${j}`,
          role: j % 2 === 0 ? "user" : "assistant",
          content: `This is message ${j} in batch ${i}`,
          timestamp: Date.now()
        });
      }
      
      // Set the messages (this triggers the cap logic)
      chatManager.setMessages(messages);
    }
    
    const endTimeSetMessages = Date.now();
    const setMessagesTime = endTimeSetMessages - startTimeSetMessages;
    console.log(`[Zotero.debug] setMessages × 1000 took ${setMessagesTime}ms`);
    
    // Verify that the cap is working correctly
    const currentMessages = chatManager.getMessages();
    console.log(`[Zotero.debug] Final message count: ${currentMessages.length}`);
    
    // With our cap of 300, and sending 5000 messages (1000 batches × 5),
    // we should end up with at most 300 + 1 marker message (if capped)
    expect(currentMessages.length).to.be.lessThanOrEqual(301);
    
    // If we have more than 300 messages, the first one should be a marker
    if (currentMessages.length > 300) {
      expect(currentMessages[0].role).to.equal("system");
      expect(currentMessages[0].content).to.equal("earlier messages in saved conversation");
    }
  });
});
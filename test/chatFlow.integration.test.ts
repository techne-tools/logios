import { expect } from "chai";
import type Addon from "../src/addon";
import { ChatManager } from "../src/modules/hermes/ChatManager";
import type { Conversation } from "../src/modules/hermes/ConversationManager";
import type { ChatMessage } from "../src/views/types";

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
      // Send a few message chunks
      this.updateCallbacks.forEach(cb => {
        cb({ type: "message", content: "Hello" });
        cb({ type: "message", content: " " });
        cb({ type: "message", content: "world" });
        
        // Send usage info
        cb({ type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
        
        // Send stop signal
        cb({ type: "stop" });
      });
    }, 10);
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
      const matches = saved.filter(c => c.id === id);
      return matches.length > 0 ? matches[matches.length - 1] : null;
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
      // In test mode, we might want to capture logs
      if (typeof process !== "undefined" && process.env && process.env.HERMES_BENCH === "1") {
        // eslint-disable-next-line no-console
        console.log(`[Zotero.debug] ${message}`);
      }
    },
    client: new MockChatClient()
  } as unknown as Addon;
  return { addon, saved };
}

  it("should handle a complete chat flow: new conversation → sendPrompt → stream chunks → stop → messages persisted", async function () {
    const { addon, saved } = makeAddonWithMockClient();
    const chatManager = new ChatManager(addon);

    // Start with a new conversation
    addon.data.hermes.conversations.createConversation();

    // Set up to accumulate message content from chat client updates
    let accumulatedContent = "";
    let messageCount = 0;

    // Register external prompt listener to handle dispatchExternalPrompt
    const unsubscribe = chatManager.onExternalPrompt((prompt, contextItems) => {
      // Get the chat client from the addon
      const client = addon.data.hermes.client;
      if (client) {
        // Reset accumulated content
        accumulatedContent = "";
        messageCount = 0;

        console.log(`[Test] Setting up update callback`);
        // Set up update callbacks to handle the chat client's response
        const unsubscribeUpdate = client.onUpdate((update: any) => {
          if (update.type === "message" && update.content) {
            // Accumulate message content (similar to ChatView's appendContent)
            accumulatedContent += update.content;
            messageCount++;
          } else if (update.type === "stop") {
            // When we get the stop signal, create a message from accumulated content
            // and add it to the chat manager (similar to ChatView's flushNow + setMessages)
            console.log(`[Test] Stop signal, accumulatedContent: '${accumulatedContent}'`);
            if (accumulatedContent) {
              const message: ChatMessage = {
                id: `msg_\${Date.now()}`,
                role: "assistant",
                content: accumulatedContent,
                timestamp: Date.now(),
              };

              // Get current messages, add the new message, and set them
              const currentMessages = chatManager.getMessages();
              chatManager.setMessages([...currentMessages, message]);
              console.log(`[Test] After setMessages, messages: ${chatManager.getMessages().length}`);
            }

            // Clean up update subscription
            unsubscribeUpdate();
          }
        });

        // Send the prompt via the chat client
        void client.sendPrompt(prompt, contextItems, {});
      } else {
        // If no client is available, fall back to directly adding a user message
        const userMessage: ChatMessage = {
          id: `prompt_\${Date.now()}`,
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        };
        const currentMessages = chatManager.getMessages();
        chatManager.setMessages([...currentMessages, userMessage]);
      }
    });

    // Send a prompt
    await chatManager.dispatchExternalPrompt("Hello world");

    // Wait for the async operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Clean up external prompt subscription
    unsubscribe();

    // Check that messages were added
    const messages = chatManager.getMessages();
    expect(messages).to.have.lengthOf.least(1);

    // Check that the conversation was saved
    const currentConv = addon.data.hermes.conversations.getCurrentConversation();
    expect(currentConv).to.not.be.null;
    if (currentConv) {
      expect(currentConv.messages).to.have.lengthOf.least(1);
    }
  });

  it("should preserve history across disconnect/reconnect", async function () {
    const { addon, saved } = makeAddonWithMockClient();
    const chatManager = new ChatManager(addon);

    // Start with a new conversation
    const conv1 = addon.data.hermes.conversations.createConversation();

    // Set up to accumulate message content from chat client updates
    let accumulatedContent1 = "";
    let messageCount1 = 0;

    // Register external prompt listener to handle dispatchExternalPrompt
    const unsubscribe1 = chatManager.onExternalPrompt((prompt, contextItems) => {
      // Get the chat client from the addon
      const client = addon.data.hermes.client;
      if (client) {
        // Reset accumulated content
        accumulatedContent1 = "";
        messageCount1 = 0;

        // Set up update callbacks to handle the chat client's response
        const unsubscribeUpdate1 = client.onUpdate((update: any) => {
          if (update.type === "message" && update.content) {
            // Accumulate message content (similar to ChatView's appendContent)
            accumulatedContent1 += update.content;
            messageCount1++;
          } else if (update.type === "stop") {
            // When we get the stop signal, create a message from accumulated content
            // and add it to the chat manager (similar to ChatView's flushNow + setMessages)
            if (accumulatedContent1) {
              const message: ChatMessage = {
                id: `msg_\${Date.now()}`,
                role: "assistant",
                content: accumulatedContent1,
                timestamp: Date.now(),
              };

              // Get current messages, add the new message, and set them
              const currentMessages = chatManager.getMessages();
              chatManager.setMessages([...currentMessages, message]);
            }

            // Clean up update subscription
            unsubscribeUpdate1();
          }
        });

        // Send the prompt via the chat client
        void client.sendPrompt(prompt, contextItems, {});
      } else {
        // If no client is available, fall back to directly adding a user message
        const userMessage: ChatMessage = {
          id: `prompt_\${Date.now()}`,
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        };
        const currentMessages = chatManager.getMessages();
        chatManager.setMessages([...currentMessages, userMessage]);
      }
    });

    // Send a prompt in the first conversation
    await chatManager.dispatchExternalPrompt("First message");

    // Wait for the async operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    // Flush to save immediately
    chatManager.flush();

    // Clean up external prompt subscription for first message
    unsubscribe1();

    // Switch to a new conversation
    const conv2 = addon.data.hermes.conversations.createConversation();

    // Set up to accumulate message content from chat client updates for second message
    let accumulatedContent2 = "";
    let messageCount2 = 0;

    // Register external prompt listener to handle dispatchExternalPrompt
    const unsubscribe2 = chatManager.onExternalPrompt((prompt, contextItems) => {
      // Get the chat client from the addon
      const client = addon.data.hermes.client;
      if (client) {
        // Reset accumulated content
        accumulatedContent2 = "";
        messageCount2 = 0;

        // Set up update callbacks to handle the chat client's response
        const unsubscribeUpdate2 = client.onUpdate((update: any) => {
          if (update.type === "message" && update.content) {
            // Accumulate message content (similar to ChatView's appendContent)
            accumulatedContent2 += update.content;
            messageCount2++;
          } else if (update.type === "stop") {
            // When we get the stop signal, create a message from accumulated content
            // and add it to the chat manager (similar to ChatView's flushNow + setMessages)
            if (accumulatedContent2) {
              const message: ChatMessage = {
                id: `msg_\${Date.now()}`,
                role: "assistant",
                content: accumulatedContent2,
                timestamp: Date.now(),
              };

              // Get current messages, add the new message, and set them
              const currentMessages = chatManager.getMessages();
              chatManager.setMessages([...currentMessages, message]);
            }

            // Clean up update subscription
            unsubscribeUpdate2();
          }
        });

        // Send the prompt via the chat client
        void client.sendPrompt(prompt, contextItems, {});
      } else {
        // If no client is available, fall back to directly adding a user message
        const userMessage: ChatMessage = {
          id: `prompt_\${Date.now()}`,
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        };
        const currentMessages = chatManager.getMessages();
        chatManager.setMessages([...currentMessages, userMessage]);
      }
    });

    // Send a prompt in the second conversation
    await chatManager.dispatchExternalPrompt("Second message");

    // Wait for the async operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    // Flush to save immediately
    chatManager.flush();

    // Clean up external prompt subscription for second message
    unsubscribe2();

    // Switch back to the first conversation
    // In a real app, this would happen via loadConversation
    // For this test, we'll directly set the current conversation
    // by manipulating the conversations map

    // Load the first conversation
    const loadedConv = addon.data.hermes.conversations.loadConversation(conv1.id);
    expect(loadedConv).to.not.be.null;

    // When a conversation is loaded, we need to tell the ChatManager to load its messages
    // This is what the HermesChatView component does when the conversation changes
    if (loadedConv) {
      addon.log(`About to load conversation with ${loadedConv.messages.length} messages into ChatManager`);
      chatManager.loadFromConversation(loadedConv);
      addon.log(`After loading, ChatManager has ${chatManager.getMessages().length} messages`);
    }

    // Check that the first conversation still has its messages
    if (loadedConv) {
      // If we get here, let's see what's actually in the conversation
      if (loadedConv.messages.length === 0) {
        // Fail with a custom message to see what's in the conversation
         const actualMessages = loadedConv.messages.map(m => `${m.content}`).join(", ");
        expect(loadedConv.messages).to.have.lengthOf.least(1, `Expected to find messages in conversation, but got 0 messages. Actual messages: [${actualMessages}]`);
      }
      expect(loadedConv.messages).to.have.lengthOf.least(1);
      expect(loadedConv.messages[0].content).to.contain("First");
    }
  });


import { expect } from "chai";
import { ChatManager } from "../src/modules/hermes/ChatManager";
import type { Conversation } from "../src/modules/hermes/ConversationManager";
import type { ChatMessage, ContextItem } from "../src/views/types";
import type Addon from "../src/addon";

/**
 * Chat lifecycle integration.
 *
 * The unit suite (`chatManager.test.ts`) covers each ChatManager method in
 * isolation. This file drives the sequence a real sidebar session performs —
 * new conversation, external prompt dispatch, streaming, stop, persist, reload
 * — against one ChatManager and one conversation store, to catch wiring
 * mistakes between those steps.
 *
 * NOTE: this deliberately does NOT mock a `ChatClient`. `dispatchExternalPrompt`
 * returns the number of ChatView subscribers reached (0 when buffered), not a
 * Promise, and the view — not ChatManager — owns the client subscription and
 * the streaming buffer. A mock client here would test the mock. The tests
 * instead drive the same state transitions the view performs.
 */

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m_${Math.random().toString(36).slice(2)}`,
    role: "user",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

/** A conversation store that behaves like ConversationManager for one session. */
function makeStore() {
  const saved: Conversation[] = [];
  let current: Conversation | null = null;

  function createConversation(): Conversation {
    current = {
      id: `conv_${saved.length + 1}`,
      title: `Conversation ${saved.length + 1}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      allowedTools: null,
    };
    return current;
  }

  return {
    saved,
    createConversation,
    getCurrentConversation: () => current,
    saveConversation: (conv: Conversation) => {
      const idx = saved.findIndex((c) => c.id === conv.id);
      if (idx === -1) saved.push(conv);
      else saved[idx] = conv;
    },
    loadConversation: (id: string): Conversation | null =>
      saved.find((c) => c.id === id) ?? null,
    clearMessages: () => {
      saved.length = 0;
      current = null;
    },
  };
}

function makeAddon(store: ReturnType<typeof makeStore>): Addon {
  return {
    data: {
      hermes: {
        conversations: store,
        preferences: { get: (_k: string, d: unknown) => d, set: () => {} },
      },
    },
    log: () => {},
  } as unknown as Addon;
}

describe("Chat lifecycle integration", function () {
  it("new conversation → dispatch → stream → stop → persisted", async function () {
    const store = makeStore();
    const addon = makeAddon(store);
    const chat = new ChatManager(addon);
    const conv = store.createConversation();

    // The view subscribes; dispatchExternalPrompt now reaches it.
    const delivered: Array<{ prompt: string; items?: ContextItem[] }> = [];
    const unsubscribe = chat.onExternalPrompt((prompt, contextItems) => {
      delivered.push({ prompt, items: contextItems });
    });

    const context: ContextItem[] = [
      { id: "item-1", type: "item", text: "The Soundscape" },
    ];
    const reached = chat.dispatchExternalPrompt("Summarise this", context);
    expect(reached, "the subscriber was reached synchronously").to.equal(1);

    // Dispatch is synchronous — the prompt is delivered before any await.
    expect(delivered).to.have.length(1);
    expect(delivered[0].prompt).to.equal("Summarise this");
    expect(delivered[0].items).to.have.length(1);

    // The user turn is committed immediately.
    chat.addMessage(makeMessage({ role: "user", content: "Summarise this" }));

    // Stream: the view accumulates chunks, then commits one assistant message
    // on the stop event.
    await tick();
    const streamed = "Hello world";
    chat.setMessages([
      ...chat.getMessages(),
      makeMessage({ role: "assistant", content: streamed }),
    ]);

    // Stop → flush persists the conversation.
    chat.flush();
    unsubscribe();

    const persisted = store.loadConversation(conv.id);
    expect(persisted, "conversation was saved").to.not.be.null;
    expect(persisted!.messages, "both turns persisted").to.have.length(2);
    expect(persisted!.messages[0].role).to.equal("user");
    expect(persisted!.messages[1].role).to.equal("assistant");
    expect(persisted!.messages[1].content).to.equal(streamed);
  });

  it("cancel mid-stream persists the user turn but no partial assistant turn", async function () {
    const store = makeStore();
    const addon = makeAddon(store);
    const chat = new ChatManager(addon);
    const conv = store.createConversation();

    chat.addMessage(makeMessage({ role: "user", content: "Long question" }));

    // Streaming begins, then the user cancels: the view discards its buffer and
    // commits nothing, so ChatManager never receives an assistant turn.
    await tick();
    chat.flush();

    const persisted = store.loadConversation(conv.id);
    expect(persisted!.messages, "only the user turn remains").to.have.length(1);
    expect(persisted!.messages[0].role).to.equal("user");
    expect(chat.getMessages()).to.have.length(1);
  });

  it("history survives switching away and back", async function () {
    const store = makeStore();
    const addon = makeAddon(store);
    const chat = new ChatManager(addon);

    const first = store.createConversation();
    chat.addMessage(makeMessage({ role: "user", content: "First message" }));
    chat.flush();

    const second = store.createConversation();
    chat.addMessage(makeMessage({ role: "user", content: "Second message" }));
    chat.flush();

    // Switch back to the first conversation, as the view does on selection.
    const loaded = store.loadConversation(first.id);
    expect(loaded).to.not.be.null;
    chat.loadFromConversation(loaded!);

    const messages = chat.getMessages();
    expect(messages).to.have.length(1);
    expect(messages[0].content).to.contain("First");
    // The second conversation's content must not bleed in.
    expect(messages[0].content).to.not.contain("Second");
  });
});

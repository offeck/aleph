import { afterEach, describe, expect, it, vi } from "vitest";
import { bindEvents, loadSyncIndicator } from "../../src/popup/ui";

type RuntimeMessage = { type: string };
type MessageCallback = (response?: unknown) => void;
type ElementListener = (event: { target: FakeElement }) => void;

class FakeElement {
  checked = false;
  disabled = false;
  value = "";
  textContent = "";
  title = "";
  style: Record<string, string> = {};

  private readonly listeners = new Map<string, ElementListener[]>();
  private readonly queryResults = new Map<string, FakeElement>();

  addEventListener(event: string, listener: ElementListener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  click() {
    this.dispatch("click");
  }

  dispatch(event: string) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener({ target: this });
    }
  }

  querySelector(selector: string) {
    return this.queryResults.get(selector) ?? null;
  }

  setQueryResult(selector: string, element: FakeElement) {
    this.queryResults.set(selector, element);
  }
}

function createPopupDom() {
  const ids = [
    "focusMode",
    "miniGame",
    "fontFamily",
    "fontSize",
    "fontSizeVal",
    "themeApplyLocal",
    "settingsBtn",
    "settingsBtn2",
    "dashboardBtn",
    "exportBtn",
    "importBtn",
    "importFile",
    "syncSignInBtn",
    "syncBar",
    "syncIndicator",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()])) as Record<string, FakeElement>;
  const signInLabel = new FakeElement();
  elements.syncSignInBtn.setQueryResult(".sync-label", signInLabel);

  vi.stubGlobal("document", {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  });

  return { elements, signInLabel };
}

function stubChrome(sendMessage: (message: RuntimeMessage, callback: MessageCallback) => void) {
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: vi.fn((path: string) => path),
      sendMessage: vi.fn(sendMessage),
    },
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
    tabs: {
      create: vi.fn(),
    },
  });

  return chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
}

describe("popup sync UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders signed-out sync status (sign-in bar shown, cloud hidden)", () => {
    const { elements } = createPopupDom();
    const sendMessage = stubChrome((message, callback) => {
      expect(message).toEqual({ type: "aleph-sync-status" });
      callback({ signedIn: false });
    });

    loadSyncIndicator();

    expect(sendMessage).toHaveBeenCalledWith({ type: "aleph-sync-status" }, expect.any(Function));
    expect(elements.syncBar.style.display).toBe("");
    expect(elements.syncIndicator.style.display).toBe("none");
  });

  it("renders signed-in sync status (cloud shown with email, bar hidden)", () => {
    const { elements } = createPopupDom();
    stubChrome((_message, callback) => {
      callback({ signedIn: true, email: "user@example.com" });
    });

    loadSyncIndicator();

    expect(elements.syncBar.style.display).toBe("none");
    expect(elements.syncIndicator.style.display).toBe("");
    expect(elements.syncIndicator.title).toBe("Cloud sync · user@example.com");
  });

  it("signs in and refreshes sync status on success", () => {
    const { elements, signInLabel } = createPopupDom();
    const sent: RuntimeMessage[] = [];
    stubChrome((message, callback) => {
      sent.push(message);
      if (message.type === "aleph-sync-signin") {
        callback({ success: true });
        return;
      }
      callback({ signedIn: true, email: "user@example.com" });
    });

    bindEvents();
    elements.syncSignInBtn.click();

    expect(sent).toEqual([{ type: "aleph-sync-signin" }, { type: "aleph-sync-status" }]);
    expect(elements.syncSignInBtn.disabled).toBe(false);
    // After success the status refresh collapses the bar to the cloud glyph.
    expect(elements.syncBar.style.display).toBe("none");
    expect(elements.syncIndicator.style.display).toBe("");
    expect(signInLabel.textContent).toBe("Sign in with Google");
  });

  it("shows a retry label after sign-in failure", () => {
    vi.useFakeTimers();
    const { elements, signInLabel } = createPopupDom();
    stubChrome((_message, callback) => {
      callback({ success: false });
    });

    bindEvents();
    elements.syncSignInBtn.click();

    expect(elements.syncSignInBtn.disabled).toBe(false);
    expect(signInLabel.textContent).toBe("Sign-in failed — retry");

    vi.advanceTimersByTime(2500);

    expect(signInLabel.textContent).toBe("Sign in with Google");
  });
});

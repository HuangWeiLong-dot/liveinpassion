import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

const CONTEXT_LIMIT = 600;
const REQUEST_DELAY = 900;

function isInCode(text) {
  const lines = text.split('\n');
  let fenced = false;
  for (const line of lines.slice(0, -1)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
  }
  if (fenced) return true;

  const currentLine = lines[lines.length - 1] || '';
  if (/^\s*(```|~~~)/.test(currentLine)) return true;
  return (currentLine.match(/`/g) || []).length % 2 === 1;
}

function completionContextAt(view, isEnabled) {
  const selection = view.state.selection.main;
  if (!isEnabled() || !view.hasFocus || !selection.empty) return null;

  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to || line.text.trim().length < 3) return null;

  const before = view.state.doc.sliceString(0, selection.head);
  if (before.trim().length < 12 || isInCode(before)) return null;
  return {
    from: selection.head,
    lineText: line.text,
    text: before.slice(-CONTEXT_LIMIT),
  };
}

class PoeticCompletionWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }

  eq(other) {
    return this.text === other.text;
  }

  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-poetic-completion';
    element.textContent = this.text;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}

class PoeticCompletionState {
  constructor(view, options) {
    this.view = view;
    this.options = options;
    this.completion = null;
    this.contextKey = '';
    this.lastAccepted = '';
    this.timer = null;
    this.controller = null;
    this.refresh(view);
  }

  get decorations() {
    if (!this.completion) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new PoeticCompletionWidget(this.completion.text),
        side: 1,
      }).range(this.completion.from),
    ]);
  }

  update(update) {
    this.view = update.view;
    this.refresh(update.view);
  }

  refresh(view) {
    const context = completionContextAt(view, this.options.isEnabled);
    if (!context || (this.lastAccepted && context.lineText.endsWith(this.lastAccepted))) {
      this.cancel();
      this.contextKey = '';
      this.completion = null;
      this.options.onStatus(this.options.isEnabled() ? 'idle' : 'off');
      return;
    }

    if (context.text === this.contextKey) return;
    this.cancel();
    this.contextKey = context.text;
    this.completion = null;
    this.options.onStatus('waiting');
    this.timer = setTimeout(() => this.request(context), REQUEST_DELAY);
  }

  async request(context) {
    this.timer = null;
    if (context.text !== this.contextKey) return;

    const controller = new AbortController();
    this.controller = controller;
    this.options.onStatus('loading');
    try {
      const text = await this.options.requestCompletion(context.text, controller.signal);
      if (controller.signal.aborted || context.text !== this.contextKey) return;

      const current = completionContextAt(this.view, this.options.isEnabled);
      const suggestion = typeof text === 'string' ? text.trim().replace(/[\r\n]+/g, ' ') : '';
      if (!current || current.text !== context.text || current.from !== context.from) return;
      if (!suggestion || current.lineText.endsWith(suggestion)) {
        this.options.onStatus('idle');
        return;
      }

      this.completion = { from: current.from, text: suggestion, context: current.text };
      this.options.onStatus('ready');
      this.view.dispatch({
        effects: EditorView.scrollIntoView(this.view.state.selection.main.head),
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      console.error('Poetic AI completion failed:', error);
      if (context.text === this.contextKey) this.options.onStatus('error');
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  accept(view) {
    const completion = this.completion;
    if (!completion) return false;

    const current = completionContextAt(view, this.options.isEnabled);
    if (!current || current.text !== completion.context || current.from !== completion.from) return false;

    this.lastAccepted = completion.text;
    this.completion = null;
    this.contextKey = '';
    this.cancel();
    view.dispatch({
      changes: { from: completion.from, insert: completion.text },
      selection: { anchor: completion.from + completion.text.length },
    });
    return true;
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  destroy() {
    this.cancel();
  }
}

export function createPoeticCompletionExtensions(options) {
  const completionPlugin = ViewPlugin.define(
    (view) => new PoeticCompletionState(view, options),
    { decorations: (state) => state.decorations },
  );
  const acceptOnTab = EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== 'Tab') return false;
      const state = view.plugin(completionPlugin);
      if (!state?.accept(view)) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  });

  return [completionPlugin, acceptOnTab];
}

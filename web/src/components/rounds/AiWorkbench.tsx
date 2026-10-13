import {
  CaretDown,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  File,
  FloppyDisk,
  Folder,
  Play,
  Robot,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AiTaskView, CodeLanguage } from '../../../../shared/types.ts';
import { api, messageOf } from '../../api.ts';
import { Chat } from '../Chat.tsx';
import { CodeEditor } from '../CodeEditor.tsx';
import { ConfirmButton } from '../ConfirmButton.tsx';
import { Markdown } from '../Markdown.tsx';
import type { RoundProps } from './RoundProps.ts';

const POLL_IDLE_MS = 15_000;
/** While the assistant works, look more often so its steps and file changes show up as they happen. */
const POLL_BUSY_MS = 4000;

const LANGUAGE_BY_EXTENSION: Record<string, CodeLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
};

function languageOf(path: string): CodeLanguage | 'plain' {
  return LANGUAGE_BY_EXTENSION[path.split('.').pop() ?? ''] ?? 'plain';
}

function nameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

/** The file a candidate most likely wants first: source code, not tests, data or the brief. */
function firstFileToOpen(files: string[]): string | undefined {
  const code = files.filter((file) => languageOf(file) !== 'plain' && !/(^|\/)tests?\//.test(file));
  return code.find((file) => file.startsWith('src/')) ?? code[0] ?? files[0];
}

interface Buffer {
  /** What is on disk, as last loaded or saved. */
  saved: string;
  /** What is in the editor. */
  draft: string;
  /** Bumped when the text is replaced from disk, so the editor takes it. */
  version: number;
  /** True when the file changed on disk while there were unsaved edits. */
  stale: boolean;
}

// ---------- File tree ----------

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null;
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    let level = root;
    const parts = file.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const isFile = index === parts.length - 1;
      let node = level.find((candidate) => candidate.name === name && (candidate.children === null) === isFile);
      if (!node) {
        node = { name, path, children: isFile ? null : [] };
        level.push(node);
      }
      if (node.children) level = node.children;
    });
  }
  // Folders first, then files, each alphabetical: the order an editor shows.
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(a.children === null) - Number(b.children === null) || a.name.localeCompare(b.name))
      .map((node) => (node.children ? { ...node, children: sort(node.children) } : node));
  return sort(root);
}

interface TreeProps {
  nodes: TreeNode[];
  depth: number;
  active: string | null;
  dirty: Set<string>;
  closed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

function Tree({ nodes, depth, active, dirty, closed, onToggle, onOpen }: TreeProps) {
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${8 + depth * 14}px` };
        if (node.children) {
          const open = !closed.has(node.path);
          return (
            <li key={node.path} role="treeitem" aria-expanded={open}>
              <button type="button" className="tree-row" style={indent} onClick={() => onToggle(node.path)}>
                {open ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}
                <Folder size={14} aria-hidden="true" />
                {node.name}
              </button>
              {open && <Tree nodes={node.children} depth={depth + 1} active={active} dirty={dirty} closed={closed} onToggle={onToggle} onOpen={onOpen} />}
            </li>
          );
        }
        return (
          <li key={node.path} role="treeitem" aria-selected={node.path === active}>
            <button
              type="button"
              className={`tree-row ${node.path === active ? 'tree-row-active' : ''}`}
              style={indent}
              onClick={() => onOpen(node.path)}
            >
              <span className="tree-spacer" aria-hidden="true" />
              <File size={14} aria-hidden="true" />
              <span className="tree-name">{node.name}</span>
              {dirty.has(node.path) && <span className="dot" role="img" aria-label="unsaved changes" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Side panel tabs ----------

type PanelId = 'task' | 'assistant' | 'interviewer';

interface PanelTab {
  id: PanelId;
  label: string;
  icon: ReactNode;
  /** New messages not yet seen on this tab. */
  unread: number;
}

function PanelTabs({ tabs, active, onChange }: { tabs: PanelTab[]; active: PanelId; onChange: (id: PanelId) => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.id);
    document.getElementById(`panel-tab-${next.id}`)?.focus();
  }
  return (
    <div className="panel-tabs" role="tablist" aria-label="Task, assistant and interviewer" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`panel-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          className={`panel-tab ${tab.id === active ? 'panel-tab-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
          {tab.unread > 0 && (
            <span className="count-badge">
              {tab.unread}
              <span className="visually-hidden"> new</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------- Workbench ----------

/**
 * The AI-agent task done on the page, laid out like an editor: files on the left, the
 * code and its tests in the middle, and the task, the AI assistant and the interviewer
 * on the right.
 */
export function AiWorkbench({ view, roundIndex, controller, locked }: RoundProps<AiTaskView>) {
  const { id } = controller;
  const [files, setFiles] = useState<string[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  // During the wrap-up the interviewer is the only thing left to do.
  const [panel, setPanel] = useState<PanelId>(view.phase === 'working' ? 'task' : 'interviewer');
  const [testsOpen, setTestsOpen] = useState(false);
  // Buffers hold every open file's text, so switching tabs keeps unsaved edits.
  const buffers = useRef(new Map<string, Buffer>());
  const [, repaint] = useState(0);
  const refresh = () => repaint((n) => n + 1);
  const working = view.phase === 'working' && !locked;

  const loadBuffer = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        const file = await api.file(id, path);
        const previous = buffers.current.get(path);
        buffers.current.set(path, { saved: file.content, draft: file.content, version: (previous?.version ?? 0) + 1, stale: false });
        setFileError(null);
        return true;
      } catch (failure) {
        setFileError(messageOf(failure));
        return false;
      }
    },
    [id],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (!buffers.current.has(path) && !(await loadBuffer(path))) return;
      setTabs((current) => (current.includes(path) ? current : [...current, path]));
      setActive(path);
    },
    [loadBuffer],
  );

  const loadFiles = useCallback(async (): Promise<string[] | null> => {
    try {
      const list = await api.files(id);
      setFiles(list);
      setFilesError(null);
      return list;
    } catch (failure) {
      setFilesError(messageOf(failure));
      return null;
    }
  }, [id]);

  useEffect(() => {
    void loadFiles().then((list) => {
      const first = list && firstFileToOpen(list);
      if (first) void openFile(first);
    });
  }, [loadFiles, openFile]);

  // The server only looks at the assistant's session when asked to.
  useEffect(() => {
    if (locked || view.phase === 'complete') return;
    const poll = () => void controller.act(roundIndex, { kind: 'poll' });
    poll();
    const timer = window.setInterval(poll, view.assistantBusy ? POLL_BUSY_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex, locked, view.phase, view.assistantBusy]);

  // When the assistant changes files, show them. A file with unsaved edits is never
  // replaced silently: it is marked, and the candidate chooses which version to keep.
  const seen = useRef({ filesChanged: view.activity.filesChanged, replies: view.assistant.length });
  useEffect(() => {
    const now = { filesChanged: view.activity.filesChanged, replies: view.assistant.length };
    if (seen.current.filesChanged === now.filesChanged && seen.current.replies === now.replies) return;
    seen.current = now;
    void loadFiles();
    void Promise.all(
      [...buffers.current.entries()].map(async ([path, buffer]) => {
        if (buffer.draft === buffer.saved) return loadBuffer(path);
        const onDisk = await api.file(id, path).catch(() => null);
        if (onDisk && onDisk.content !== buffer.saved) buffer.stale = true;
        return true;
      }),
    ).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.activity.filesChanged, view.assistant.length]);

  // New messages on a tab that is not showing are counted, so a question is not missed.
  const interviewerCount = view.transcript.filter((message) => message.from === 'interviewer').length;
  const assistantCount = view.assistant.filter((message) => message.from === 'assistant').length;
  const read = useRef({ interviewer: interviewerCount, assistant: assistantCount });
  if (panel === 'interviewer') read.current.interviewer = interviewerCount;
  if (panel === 'assistant') read.current.assistant = assistantCount;
  const unreadInterviewer = interviewerCount - read.current.interviewer;

  const dirty = new Set([...buffers.current.entries()].filter(([, entry]) => entry.draft !== entry.saved).map(([path]) => path));
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const buffer = active ? buffers.current.get(active) : undefined;

  async function save(path: string): Promise<boolean> {
    const target = buffers.current.get(path);
    if (!target || target.draft === target.saved) return true;
    const text = target.draft;
    if (!(await controller.act(roundIndex, { kind: 'save_file', path, content: text }))) return false;
    target.saved = text;
    target.stale = false;
    refresh();
    // So the count of changed files follows the save instead of waiting for the next look.
    void controller.act(roundIndex, { kind: 'poll' });
    return true;
  }

  async function saveAll(): Promise<boolean> {
    for (const path of dirty) if (!(await save(path))) return false;
    return true;
  }

  async function runTests() {
    setTestsOpen(true);
    if (await saveAll()) await controller.act(roundIndex, { kind: 'run_tests' });
  }

  async function closeTab(path: string) {
    if (!(await save(path))) return;
    buffers.current.delete(path);
    setTabs((current) => {
      const next = current.filter((tab) => tab !== path);
      if (path === active) setActive(next[Math.max(0, current.indexOf(path) - 1)] ?? null);
      return next;
    });
  }

  async function reloadFromDisk(path: string) {
    if (await loadBuffer(path)) refresh();
  }

  // Save works from anywhere on the screen, not only while the cursor is in the editor,
  // and the browser's own "save page" dialog never opens over the workspace.
  const saveActive = useRef(() => {});
  saveActive.current = () => {
    if (active) void save(active);
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActive.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const saving = controller.busy === 'save_file';
  const testing = controller.busy === 'run_tests';
  const lastStep = view.assistantSteps.at(-1);
  const test = view.lastTest;

  const panelTabs: PanelTab[] = [
    { id: 'task', label: 'Task', icon: <ClipboardText size={16} aria-hidden="true" />, unread: 0 },
    { id: 'assistant', label: 'Assistant', icon: <Robot size={16} aria-hidden="true" />, unread: assistantCount - read.current.assistant },
    { id: 'interviewer', label: 'Interviewer', icon: <ChatCircleDots size={16} aria-hidden="true" />, unread: unreadInterviewer },
  ];

  return (
    <div className="workbench">
      {/* ---- Files ---- */}
      <nav className="pane pane-files" aria-label="Files">
        <div className="pane-head">Files</div>
        <div className="pane-body">
          {filesError && (
            <p className="field-error pane-pad" role="alert">
              {filesError}
            </p>
          )}
          {!files && !filesError && <div className="skeleton pane-pad" />}
          {files?.length === 0 && <p className="hint pane-pad">The workspace is empty.</p>}
          <Tree
            nodes={tree}
            depth={0}
            active={active}
            dirty={dirty}
            closed={closedFolders}
            onOpen={(path) => void openFile(path)}
            onToggle={(path) =>
              setClosedFolders((current) => {
                const next = new Set(current);
                if (!next.delete(path)) next.add(path);
                return next;
              })
            }
          />
        </div>
      </nav>

      {/* ---- Editor and tests ---- */}
      <section className="pane pane-editor" aria-label="Editor">
        <div className="editor-tabs" role="tablist" aria-label="Open files">
          {tabs.map((path) => (
            <div key={path} className={`editor-tab ${path === active ? 'editor-tab-active' : ''}`}>
              <button type="button" role="tab" aria-selected={path === active} className="editor-tab-name" title={path} onClick={() => setActive(path)}>
                {nameOf(path)}
                {dirty.has(path) && <span className="dot" role="img" aria-label="unsaved changes" />}
              </button>
              <button type="button" className="editor-tab-close" aria-label={`Close ${path}`} onClick={() => void closeTab(path)}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          <span className="editor-actions">
            <button type="button" className="button button-compact" onClick={() => active && void save(active)} disabled={!active || !dirty.has(active) || saving || !working}>
              <FloppyDisk size={15} aria-hidden="true" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="button button-primary button-compact" onClick={() => void runTests()} disabled={testing || locked}>
              {testing ? <CircleNotch size={15} className="spin" aria-hidden="true" /> : <Play size={15} weight="fill" aria-hidden="true" />}
              {testing ? 'Running…' : 'Run tests'}
            </button>
          </span>
        </div>

        {fileError && (
          <p className="field-error pane-pad" role="alert">
            {fileError}
          </p>
        )}
        {buffer?.stale && active && (
          <div className="banner" role="status">
            <WarningCircle size={16} aria-hidden="true" />
            <span>The assistant changed this file while you had unsaved edits.</span>
            <button type="button" className="button button-compact" onClick={() => void save(active)}>
              Keep mine
            </button>
            <button type="button" className="button button-compact" onClick={() => void reloadFromDisk(active)}>
              Take the assistant's
            </button>
          </div>
        )}

        <div className="editor-area">
          {active && buffer ? (
            <CodeEditor
              documentKey={`${active}:${buffer.version}`}
              initialValue={buffer.draft}
              language={languageOf(active)}
              label={`Editor, ${active}`}
              onRun={() => void runTests()}
              onChange={(value) => {
                const wasDirty = buffer.draft !== buffer.saved;
                buffer.draft = value;
                // Repaint only when the unsaved marker has to appear or disappear.
                if (wasDirty !== (value !== buffer.saved)) refresh();
              }}
            />
          ) : (
            <div className="editor-empty">
              <File size={28} aria-hidden="true" />
              <p>{files ? 'Pick a file on the left to open it.' : 'Loading the workspace…'}</p>
            </div>
          )}
        </div>

        <div className={`tests ${testsOpen ? 'tests-open' : ''}`}>
          <button type="button" className="tests-head" aria-expanded={testsOpen} onClick={() => setTestsOpen((current) => !current)}>
            {testsOpen ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}
            Tests
            {testing ? (
              <span className="status status-muted">
                <CircleNotch size={14} className="spin" aria-hidden="true" /> Running
              </span>
            ) : test ? (
              <span className={`status ${test.passed ? 'status-ok' : 'status-bad'}`}>
                {test.passed ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : <XCircle size={14} weight="fill" aria-hidden="true" />}
                {test.passed ? 'Passing' : 'Failing'}
              </span>
            ) : (
              <span className="status status-muted">Not run yet</span>
            )}
          </button>
          {testsOpen && (
            <pre className="tests-output" tabIndex={0} aria-live="polite">
              {test ? test.output || 'The tests printed nothing.' : 'Run the tests to see their output here. Ctrl or ⌘ + Enter in the editor does it too.'}
            </pre>
          )}
        </div>
      </section>

      {/* ---- Task, assistant, interviewer ---- */}
      <section className="pane pane-side" aria-label="Task, assistant and interviewer">
        <PanelTabs tabs={panelTabs} active={panel} onChange={setPanel} />

        {unreadInterviewer > 0 && panel !== 'interviewer' && (
          <div className="banner banner-accent" role="status">
            <ChatCircleDots size={16} aria-hidden="true" />
            <span>The interviewer has asked you something.</span>
            <button type="button" className="button button-compact" onClick={() => setPanel('interviewer')}>
              Answer
            </button>
          </div>
        )}

        <div id={`panel-${panel}`} role="tabpanel" aria-labelledby={`panel-tab-${panel}`} className="panel-body">
          {panel === 'task' && (
            <div className="panel-scroll">
              <h2 className="panel-title">{view.title}</h2>
              <Markdown source={view.brief.replace(/^# .*\n+/, '')} />
            </div>
          )}

          {panel === 'assistant' && (
            <div className="panel-chat">
              {view.assistantError && (
                <p className="field-error" role="alert">
                  The assistant could not finish: {view.assistantError} Ask it again.
                </p>
              )}
              {view.assistantBusy && view.assistantSteps.length > 0 && (
                <ol className="steps" aria-label="What the assistant is doing">
                  {view.assistantSteps.map((step, index) => (
                    <li key={index} className={index === view.assistantSteps.length - 1 ? 'step-current' : ''}>
                      {step}
                    </li>
                  ))}
                </ol>
              )}
              <Chat
                rich
                messages={view.assistant}
                onSend={(message) => controller.act(roundIndex, { kind: 'agent', message })}
                sending={view.assistantBusy || controller.busy === 'agent'}
                waitingLabel={lastStep ? 'Working…' : 'The assistant is working. This can take a minute or two.'}
                placeholder="Tell the assistant what to do. It works in these files and can run the tests."
                inputLabel="Message to the AI assistant"
                emptyLabel="Nothing asked yet. How you direct the assistant and check its work is what is scored."
                disabled={!working}
              />
            </div>
          )}

          {panel === 'interviewer' && (
            <div className="panel-chat">
              <Chat
                messages={view.transcript}
                onSend={(text) => controller.act(roundIndex, { kind: 'answer', text })}
                sending={controller.busy === 'answer'}
                waitingLabel="Sending…"
                placeholder="Answer the interviewer here."
                inputLabel="Your answer to the interviewer"
                disabled={locked || view.phase === 'complete'}
              />
            </div>
          )}
        </div>
      </section>

      {/* ---- Status bar ---- */}
      <footer className="statusbar">
        <span>{view.activity.filesChanged === 1 ? '1 file changed' : `${view.activity.filesChanged} files changed`}</span>
        <span>{dirty.size === 0 ? 'All saved' : `${dirty.size} unsaved`}</span>
        <span>
          {view.activity.prompts} {view.activity.prompts === 1 ? 'request' : 'requests'} to the assistant
        </span>
        <span className="statusbar-hint">⌘/Ctrl + S save · ⌘/Ctrl + Enter run tests</span>
        {view.phase === 'working' ? (
          <span className="statusbar-end">
            <ConfirmButton
              confirmLabel="Yes, I am done coding"
              onConfirm={() => void saveAll().then((saved) => saved && controller.act(roundIndex, { kind: 'finish_work' }).then((ok) => ok && setPanel('interviewer')))}
              disabled={locked || view.assistantBusy || controller.busy === 'finish_work'}
            >
              {controller.busy === 'finish_work' ? 'Reading your changes…' : 'I am done, start the wrap-up'}
            </ConfirmButton>
          </span>
        ) : (
          <span className="statusbar-end status status-muted">Wrap-up: answer the interviewer</span>
        )}
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ExternalLink, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import type { AppUser, Workspace } from "../types";
import { bytesBuffer, getLocalFile, saveLocalFile } from "../lib/local-files";

interface EditorFile {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  content_type: string;
  size: number;
  current_version: number;
  updated_at: number;
}
interface EditorMessage {
  type?: string;
  name?: string;
  saveAs?: boolean;
  bytes?: ArrayBuffer | Uint8Array;
  dirty?: boolean;
  error?: string;
}

const endpoint = (workspaceId: string, fileId: string) => `/api/workspaces/${workspaceId}/files/${fileId}`;
function issueText(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "Não foi possível salvar o documento.";
}
function appendConflictSuffix(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (cópia de recuperação)${name.slice(dot)}` : `${name} (cópia de recuperação)`;
}
function bytesOf(value: EditorMessage["bytes"]): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  return null;
}

export function TextEditorPage({ workspace, user, fileId, localMode = false, onExit, onNotice }: {
  workspace: Workspace;
  user: AppUser;
  fileId: string;
  localMode?: boolean;
  onExit: () => void;
  onNotice: (message: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<EditorFile | null>(null);
  const editorNameRef = useRef("");
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [file, setFile] = useState<EditorFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const sendOpen = useCallback(async () => {
    const current = fileRef.current;
    const target = frameRef.current?.contentWindow;
    if (!current || !target || !readyRef.current) return;
    try {
      if (localMode) {
        const local = await getLocalFile(current.id);
        if (!local || local.workspaceId !== workspace.id) throw new Error("Este arquivo não está disponível neste navegador.");
        const bytes = local.bytes.slice(0);
        editorNameRef.current = local.name;
        target.postMessage({ type: "wordcraft:open", name: local.name, bytes }, window.location.origin, [bytes]);
        return;
      }
      const response = await fetch(`${endpoint(workspace.id, current.id)}/content`, { credentials: "include" });
      if (!response.ok) throw new Error(issueText(await response.json().catch(() => null)));
      const bytes = await response.arrayBuffer();
      editorNameRef.current = current.name;
      target.postMessage({ type: "wordcraft:open", name: current.name, bytes }, window.location.origin, [bytes]);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível abrir o documento."); }
  }, [localMode, workspace.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setFile(null); fileRef.current = null; readyRef.current = false; setError("");
    const loadFile = localMode
      ? getLocalFile(fileId).then((local) => {
          if (!local || local.workspaceId !== workspace.id) throw new Error("Este arquivo não está disponível neste navegador.");
          return { file: { id: local.id, workspace_id: local.workspaceId, folder_id: null, name: local.name, content_type: local.contentType, size: local.size, current_version: local.currentVersion, updated_at: local.updatedAt } };
        })
      : fetch(endpoint(workspace.id, fileId), { credentials: "include" }).then(async (response) => {
          if (!response.ok) throw new Error(issueText(await response.json().catch(() => null)));
          return response.json() as Promise<{ file: EditorFile }>;
        });
    void loadFile
      .then(({ file: next }) => {
        if (cancelled) return;
        fileRef.current = next; setFile(next); editorNameRef.current = next.name;
        if (readyRef.current) void sendOpen();
      })
      .catch((issue: unknown) => { if (!cancelled) setError(issue instanceof Error ? issue.message : "Não foi possível carregar o arquivo."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, localMode, sendOpen, workspace.id]);

  const createFile = useCallback(async (name: string, bytes: Uint8Array, contentType: string) => {
    if (localMode) {
      const time = Date.now();
      const id = crypto.randomUUID();
      await saveLocalFile({ id, workspaceId: workspace.id, name, contentType, size: bytes.byteLength, currentVersion: 1, createdAt: time, updatedAt: time, bytes: bytesBuffer(bytes) });
      return { id, workspace_id: workspace.id, folder_id: null, name, content_type: contentType, size: bytes.byteLength, current_version: 1, updated_at: time } satisfies EditorFile;
    }
    const response = await fetch(`/api/workspaces/${workspace.id}/files`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...(fileRef.current?.folder_id ? { "X-Folder-Id": fileRef.current.folder_id } : {}) },
      body: new Blob([bytes as BlobPart], { type: contentType || "application/octet-stream" }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(issueText(payload));
    return (payload as { file: EditorFile }).file;
  }, [localMode, workspace.id]);

  const saveMessage = useCallback(async (message: EditorMessage) => {
    const bytes = bytesOf(message.bytes);
    if (!bytes || !bytes.byteLength) { setError("O editor enviou um documento vazio. O arquivo não foi alterado."); return; }
    if (bytes.byteLength > 20 * 1024 * 1024) { setError("O documento passou do limite de 20 MB e não foi salvo."); return; }
    const current = fileRef.current;
    if (!current) return;
    setSaving(true); setSaved(false); setError("");
    const outputName = message.name?.trim() || current.name;
    const isCurrentSave = message.saveAs === false && outputName === editorNameRef.current;
    const extension = outputName.split(".").at(-1)?.toLowerCase() ?? "";
    const contentType = extension === "pdf" ? "application/pdf" : "application/octet-stream";
    try {
      if (!isCurrentSave) {
        const created = await createFile(outputName, bytes, contentType);
        if (message.saveAs) {
          fileRef.current = created; setFile(created); editorNameRef.current = outputName;
          onNotice(localMode ? "Cópia salva neste navegador." : "Documento salvo com outro nome.");
        } else {
          onNotice(localMode ? `Cópia salva neste navegador como “${created.name}”.` : `Cópia exportada para “${created.name}”.`);
        }
      } else {
        if (localMode) {
          const stored = await getLocalFile(current.id);
          if (!stored || stored.workspaceId !== workspace.id) throw new Error("Este arquivo não está disponível neste navegador.");
          const updatedAt = Date.now();
          await saveLocalFile({ ...stored, name: outputName, contentType, size: bytes.byteLength, currentVersion: current.current_version + 1, updatedAt, bytes: bytesBuffer(bytes) });
          const updated = { ...current, name: outputName, content_type: contentType, size: bytes.byteLength, current_version: current.current_version + 1, updated_at: updatedAt };
          fileRef.current = updated; setFile(updated); editorNameRef.current = outputName;
          onNotice("Alterações salvas neste navegador.");
        } else {
          const response = await fetch(`${endpoint(workspace.id, current.id)}/content?baseVersion=${current.current_version}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Blob([bytes as BlobPart], { type: contentType }),
          });
          const payload = await response.json().catch(() => null);
          if (response.status === 409) {
            const recoveryName = appendConflictSuffix(outputName);
            const recovered = await createFile(recoveryName, bytes, contentType);
            fileRef.current = recovered; setFile(recovered); editorNameRef.current = outputName;
            onNotice(`Havia uma versão mais nova. Seu conteúdo foi preservado em “${recovered.name}”.`);
          } else if (!response.ok) throw new Error(issueText(payload));
          else {
            const version = (payload as { version: number }).version;
            const updated = { ...current, size: bytes.byteLength, current_version: version, updated_at: Date.now() };
            fileRef.current = updated; setFile(updated);
            onNotice("Alterações salvas no Google Drive.");
          }
        }
      }
      setDirty(false); dirtyRef.current = false; setSaved(true);
      window.setTimeout(() => setSaved(false), 2600);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível salvar o documento."); }
    finally { setSaving(false); }
  }, [createFile, localMode, onNotice, workspace.id]);

  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent<EditorMessage>) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message.type !== "string") return;
      if (message.type === "wordcraft:ready") {
        readyRef.current = true;
        void sendOpen();
      } else if (message.type === "wordcraft:dirty") {
        dirtyRef.current = Boolean(message.dirty); setDirty(Boolean(message.dirty));
      } else if (message.type === "wordcraft:save") {
        void saveMessage(message);
      } else if (message.type === "wordcraft:failed") {
        setError(message.error || "O editor não conseguiu iniciar neste navegador.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [saveMessage, sendOpen]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  function exit() {
    if (dirtyRef.current && !window.confirm("Há alterações que ainda não foram salvas. Deseja sair do editor?")) return;
    onExit();
  }

  const src = `/tools/text/index.html?host=parent&author=${encodeURIComponent(user.name)}`;
  return <section className="text-editor-page">
    <header className="text-editor-toolbar"><button className="button button-secondary editor-back-button" onClick={exit}><ArrowLeft size={16} /> Arquivos</button><span className="editor-file-name"><span className="editor-file-mark"><FileTextIcon /></span><span><b>{file?.name ?? "Documento"}</b><small>{localMode ? "Somente neste navegador" : workspace.name}</small></span></span><span className={`editor-save-state ${saving ? "busy" : dirty ? "dirty" : saved ? "saved" : ""}`}>{saving ? <><LoaderCircle size={14} className="spin" /> Salvando…</> : dirty ? <><Save size={14} /> Alterações não salvas</> : saved ? <><Check size={14} /> Salvo</> : file ? <><ShieldCheck size={14} /> {localMode ? "Cópia local" : "Salvamento versionado"}</> : null}</span><a className="editor-license-link" href="/tools/text/licencas/FONTE.md" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Licenças</a></header>
    {error && <div className="form-error editor-error" role="alert">{error}</div>}
    <div className="text-editor-frame-wrap">{(loading || error) && <div className="text-editor-loading"><span className="file-spinner" /><b>{loading ? "Abrindo documento…" : "Editor indisponível"}</b><span>{loading ? (localMode ? "O conteúdo está salvo neste navegador." : "O conteúdo está sendo carregado do Google Drive.") : "Confira a conexão e tente abrir o arquivo novamente."}</span></div>}
      <iframe ref={frameRef} className="text-editor-frame" src={src} title={`Editor de texto: ${file?.name ?? "documento"}`} allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen />
    </div>
    <footer className="text-editor-footer"><span><ShieldCheck size={14} /> {localMode ? "Este arquivo fica apenas neste navegador." : "Arquivo visível apenas para membros deste espaço."}</span><span>{localMode ? "Baixe o arquivo para manter uma cópia fora deste navegador." : "As alterações são salvas como novas versões no Google Drive."}</span></footer>
  </section>;
}

function FileTextIcon() { return <span className="editor-mark-text">G</span>; }

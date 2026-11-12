import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, Check, ChevronRight, CloudOff, FileText, Folder,
  FolderPlus, HardDrive, History, MoreHorizontal, Pencil, Plus, RotateCcw, Search,
  ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import JSZip from "jszip";
import { api, downloadBlob, formatDate, json } from "../lib/api";
import { bytesBuffer, deleteLocalFile, listLocalFiles, saveLocalFile, type LocalWorkspaceFile } from "../lib/local-files";
import type { AppUser, Workspace } from "../types";
import { TextEditorPage } from "./TextEditorPage";

interface WorkspaceFile {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  content_type: string;
  size: number;
  current_version: number;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface FolderRow { id: string; workspace_id: string; parent_folder_id: string | null; name: string; created_at: number; updated_at: number }
interface FolderTreeRow { id: string; parent_folder_id: string | null; name: string }
interface FileVersion { id: string; file_id: string; version_number: number; size: number; content_type: string; created_at: number; created_by_name?: string }
interface LibraryData {
  driveConnected: boolean;
  files: WorkspaceFile[];
  folders: FolderRow[];
  folderTree: FolderTreeRow[];
  currentFolder: { id: string; name: string; parent_folder_id: string | null } | null;
  breadcrumbs: Array<{ id: string; name: string }>;
  usage: { bytes: number; files: number; limitBytes: number };
}

const editableExtensions = new Set(["docx", "odt", "rtf", "txt", "md"]);
const basePath = (workspaceId: string) => `/api/workspaces/${workspaceId}/files`;
const textEditorPath = (fileId: string) => `/acesso/arquivos/${fileId}/editar`;

function extension(name: string) { return name.split(".").at(-1)?.toLowerCase() ?? ""; }
function editable(name: string) { return editableExtensions.has(extension(name)); }
function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível concluir esta ação.");
  return payload as T;
}
async function upload(workspaceId: string, file: Blob, name: string, folderId: string | null) {
  const response = await fetch(basePath(workspaceId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...(folderId ? { "X-Folder-Id": folderId } : {}) },
    body: file,
  });
  return responseJson<{ file: WorkspaceFile }>(response);
}
async function downloadFile(workspaceId: string, file: WorkspaceFile, version?: number) {
  const response = await fetch(`${basePath(workspaceId)}/${file.id}/content${version ? `?version=${version}` : ""}`, { credentials: "include" });
  if (!response.ok) { await responseJson<never>(response); return; }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function FilesPage({ workspace, user, onNotice }: { workspace: Workspace; user: AppUser; onNotice: (message: string) => void }) {
  const initialEditor = window.location.pathname.match(/^\/acesso\/arquivos\/([^/]+)\/editar$/)?.[1] ?? "";
  const [editorFileId, setEditorFileId] = useState(initialEditor);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [data, setData] = useState<LibraryData | null>(null);
  const [localFiles, setLocalFiles] = useState<LocalWorkspaceFile[]>([]);
  const [trashFiles, setTrashFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionMenu, setActionMenu] = useState("");
  const [versionsFile, setVersionsFile] = useState<WorkspaceFile | null>(null);
  const [moveFile, setMoveFile] = useState<WorkspaceFile | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const reloadLocalFiles = useCallback(async () => {
    setLocalFiles(await listLocalFiles(workspace.id));
  }, [workspace.id]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (trash) {
        const result = await api<{ files: WorkspaceFile[] }>(`workspaces/${workspace.id}/files/trash`);
        setTrashFiles(result.files);
      } else {
        const params = new URLSearchParams();
        if (folderId) params.set("folderId", folderId);
        if (search) params.set("q", search);
        const suffix = params.size ? `?${params}` : "";
        const result = await api<LibraryData>(`workspaces/${workspace.id}/files${suffix}`);
        setData(result);
        setLocalFiles(await listLocalFiles(workspace.id));
      }
    } catch (issue) { setError(message(issue)); }
    finally { setLoading(false); }
  }, [folderId, search, trash, workspace.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const syncEditor = () => setEditorFileId(window.location.pathname.match(/^\/acesso\/arquivos\/([^/]+)\/editar$/)?.[1] ?? "");
    window.addEventListener("popstate", syncEditor);
    return () => window.removeEventListener("popstate", syncEditor);
  }, []);

  const folderOptions = useMemo(() => {
    const rows = data?.folderTree ?? [];
    const children = new Map<string | null, FolderTreeRow[]>();
    for (const row of rows) children.set(row.parent_folder_id, [...(children.get(row.parent_folder_id) ?? []), row]);
    const options: Array<{ id: string; label: string }> = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const row of children.get(parentId) ?? []) {
        options.push({ id: row.id, label: `${"　".repeat(depth)}${row.name}` });
        visit(row.id, depth + 1);
      }
    };
    visit(null, 0);
    return options;
  }, [data?.folderTree]);

  async function createFolder() {
    const name = window.prompt("Nome da pasta");
    if (!name?.trim()) return;
    try { await api(`workspaces/${workspace.id}/files/folders`, json({ name, parentFolderId: folderId })); await load(); onNotice("Pasta criada."); }
    catch (issue) { setError(message(issue)); }
  }
  async function renameFolder(folder: FolderRow) {
    const name = window.prompt("Novo nome da pasta", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try { await api(`workspaces/${workspace.id}/files/folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await load(); onNotice("Pasta renomeada."); }
    catch (issue) { setError(message(issue)); }
  }
  async function deleteFolder(folder: FolderRow) {
    if (!window.confirm(`Remover a pasta “${folder.name}”? Ela precisa estar vazia.`)) return;
    try { await api(`workspaces/${workspace.id}/files/folders/${folder.id}`, { method: "DELETE" }); await load(); onNotice("Pasta removida."); }
    catch (issue) { setError(message(issue)); }
  }
  async function uploadSelected(file?: File | null) {
    if (!file) return;
    setBusy(true); setError("");
    try { await upload(workspace.id, file, file.name, folderId); await load(); onNotice("Arquivo enviado para o espaço."); }
    catch (issue) { setError(message(issue)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function uploadLocalCopy(file: LocalWorkspaceFile) {
    setBusy(true); setError("");
    try {
      await upload(workspace.id, new Blob([file.bytes], { type: file.contentType }), file.name, null);
      await deleteLocalFile(file.id); await load(); onNotice(`“${file.name}” foi enviado ao Google Drive.`);
    } catch (issue) { setError(message(issue)); }
    finally { setBusy(false); }
  }
  async function createTextDocument() {
    setBusy(true); setError("");
    try {
      const blob = await blankDocx();
      const name = "Novo documento.docx";
      const result = await upload(workspace.id, blob, name, folderId);
      await load(); openEditor(result.file.id); onNotice("Documento criado.");
    } catch (issue) { setError(message(issue)); }
    finally { setBusy(false); }
  }
  async function renameFile(file: WorkspaceFile) {
    const name = window.prompt("Novo nome do arquivo", file.name);
    if (!name?.trim() || name.trim() === file.name) return;
    try { await api(`workspaces/${workspace.id}/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await load(); onNotice("Arquivo renomeado."); }
    catch (issue) { setError(message(issue)); }
  }
  async function moveSelected() {
    if (!moveFile) return;
    try {
      await api(`workspaces/${workspace.id}/files/${moveFile.id}`, { method: "PATCH", body: JSON.stringify({ folderId: moveTarget || null }) });
      setMoveFile(null); await load(); onNotice("Arquivo movido.");
    } catch (issue) { setError(message(issue)); }
  }
  async function removeFile(file: WorkspaceFile) {
    if (!window.confirm(`Mover “${file.name}” para a lixeira?`)) return;
    try { await api(`workspaces/${workspace.id}/files/${file.id}`, { method: "DELETE" }); await load(); onNotice("Arquivo movido para a lixeira."); }
    catch (issue) { setError(message(issue)); }
  }
  async function restoreFile(file: WorkspaceFile) {
    try { await api(`workspaces/${workspace.id}/files/${file.id}/restore-trash`, json({})); await load(); onNotice("Arquivo restaurado."); }
    catch (issue) { setError(message(issue)); }
  }
  async function permanentlyDelete(file: WorkspaceFile) {
    if (!window.confirm(`Excluir “${file.name}” permanentemente, incluindo todas as versões? Esta ação não pode ser desfeita.`)) return;
    try { await api(`workspaces/${workspace.id}/files/${file.id}?permanent=true`, { method: "DELETE" }); await load(); onNotice("Arquivo e histórico excluídos permanentemente."); }
    catch (issue) { setError(message(issue)); }
  }
  function openEditor(fileId: string) {
    const path = textEditorPath(fileId);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setEditorFileId(fileId);
  }
  function exitEditor() {
    const path = viewUrl();
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setEditorFileId("");
    void load();
  }

  if (editorFileId && data?.driveConnected) return <TextEditorPage workspace={workspace} user={user} fileId={editorFileId} onExit={exitEditor} onNotice={onNotice} />;
  if (editorFileId && data && !data.driveConnected) return <TextEditorPage workspace={workspace} user={user} fileId={editorFileId} localMode onExit={exitEditor} onNotice={onNotice} />;
  if (data && !data.driveConnected) return <LocalFilesPanel workspace={workspace} files={localFiles} onFilesChanged={reloadLocalFiles} onNotice={onNotice} onOpenEditor={openEditor} />;

  const files = trash ? trashFiles : data?.files ?? [];
  return <div className="page files-page">
    <div className="page-heading files-heading"><div><p className="eyebrow">ARQUIVOS DA EQUIPE</p><h1>{trash ? "Lixeira" : "Arquivos do espaço"}</h1><p className="page-intro">Biblioteca compartilhada com as pessoas que participam de <b>{workspace.name}</b>.</p></div>
      <div className="file-toolbar-actions">
        {!trash && <><button className="button button-secondary" onClick={() => void createFolder()}><FolderPlus size={16} /> Nova pasta</button><button className="button button-secondary" onClick={() => void createTextDocument()} disabled={busy}><Plus size={16} /> Novo documento</button><button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} /> {busy ? "Enviando…" : "Enviar arquivo"}</button><input ref={fileInput} className="visually-hidden" type="file" onChange={(event) => void uploadSelected(event.target.files?.[0])} /></>}
      </div>
    </div>
    <div className="file-library-panel panel">
      <div className="file-library-toolbar">
        <div className="file-breadcrumbs"><button onClick={() => { setTrash(false); setFolderId(null); setQuery(""); }} className={!folderId && !trash ? "current" : ""}>Arquivos</button>{!trash && data?.breadcrumbs.map((crumb) => <span key={crumb.id}><ChevronRight size={14} /><button className={folderId === crumb.id ? "current" : ""} onClick={() => setFolderId(crumb.id)}>{crumb.name}</button></span>)}</div>
        <div className="file-library-controls"><label className="search-field"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setTrash(false); }} placeholder="Buscar arquivos" /></label><button className={`file-trash-toggle ${trash ? "selected" : ""}`} onClick={() => { setTrash(!trash); setQuery(""); setSearch(""); }}><Trash2 size={15} /> Lixeira</button></div>
      </div>
      {!trash && <div className="file-storage-note"><ShieldCheck size={15} /><span>Arquivos privados no Google Drive conectado · {formatBytes(data?.usage.bytes ?? 0)} armazenados, incluindo versões anteriores e lixeira</span></div>}
      {!trash && localFiles.length > 0 && <section className="local-import-notice"><div><b>Cópias locais deste navegador</b><small>Escolha quais deseja enviar para a pasta compartilhada do Drive.</small></div>{localFiles.map((file) => <div className="local-import-row" key={file.id}><span><b>{file.name}</b><small>{formatBytes(file.size)} · somente neste navegador</small></span><button className="button button-secondary" disabled={busy} onClick={() => void uploadLocalCopy(file)}><Upload size={14} /> Enviar ao Drive</button></div>)}</section>}
      {error && <div className="form-error file-error" role="alert">{error}</div>}
      {loading ? <div className="file-empty-state"><span className="file-spinner" />Carregando arquivos…</div> : files.length || (!trash && !search && (data?.folders.length ?? 0) > 0) ? <div className="file-list">
        {!trash && !search && data?.folders.map((folder) => <div className="file-list-row" key={folder.id}>
          <button className="file-main-cell" onClick={() => setFolderId(folder.id)}><span className="file-row-icon folder"><Folder size={18} /></span><span className="file-row-copy"><b>{folder.name}</b><small>Pasta</small></span></button>
          <span className="file-list-meta">—</span><span className="file-list-meta">{formatDate(folder.updated_at)}</span>
          <div className="file-row-actions"><button className="icon-button" aria-label={`Opções de ${folder.name}`} onClick={() => setActionMenu(actionMenu === folder.id ? "" : folder.id)}><MoreHorizontal size={18} /></button>{actionMenu === folder.id && <div className="file-action-menu"><button onClick={() => { setActionMenu(""); void renameFolder(folder); }}><Pencil size={14} /> Renomear</button><button className="danger" onClick={() => { setActionMenu(""); void deleteFolder(folder); }}><Trash2 size={14} /> Excluir pasta</button></div>}</div>
        </div>)}
        {files.map((file) => <div className="file-list-row" key={file.id}>
          <button className="file-main-cell" onClick={() => trash ? undefined : editable(file.name) ? openEditor(file.id) : void downloadFile(workspace.id, file)}><span className="file-row-icon document"><FileText size={18} /></span><span className="file-row-copy"><b>{file.name}</b><small>{extension(file.name).toUpperCase() || "ARQUIVO"} · {formatBytes(file.size)}{file.current_version > 1 ? ` · v${file.current_version}` : ""}</small></span></button>
          <span className="file-list-meta">{formatBytes(file.size)}</span><span className="file-list-meta">{formatDate(file.updated_at)}</span>
          <div className="file-row-actions"><button className="icon-button" aria-label={`Opções de ${file.name}`} onClick={() => setActionMenu(actionMenu === file.id ? "" : file.id)}><MoreHorizontal size={18} /></button>{actionMenu === file.id && <div className="file-action-menu">
            {trash ? <><button onClick={() => { setActionMenu(""); void restoreFile(file); }}><RotateCcw size={14} /> Restaurar arquivo</button><button className="danger" onClick={() => { setActionMenu(""); void permanentlyDelete(file); }}><Trash2 size={14} /> Excluir permanentemente</button></> : <>
              {editable(file.name) && <button onClick={() => { setActionMenu(""); openEditor(file.id); }}><FileText size={14} /> Abrir no editor</button>}
              <button onClick={() => { setActionMenu(""); void downloadFile(workspace.id, file); }}><ArrowDownToLine size={14} /> Baixar</button>
              <button onClick={() => { setActionMenu(""); setVersionsFile(file); }}><History size={14} /> Histórico de versões</button>
              <button onClick={() => { setActionMenu(""); void renameFile(file); }}><Pencil size={14} /> Renomear</button>
              <button onClick={() => { setActionMenu(""); setMoveFile(file); setMoveTarget(file.folder_id ?? ""); }}><Folder size={14} /> Mover para…</button>
              <button className="danger" onClick={() => { setActionMenu(""); void removeFile(file); }}><Trash2 size={14} /> Mover para lixeira</button>
            </>}
          </div>}</div>
          {trash && <button className="icon-button file-restore-button" aria-label={`Restaurar ${file.name}`} onClick={() => void restoreFile(file)}><RotateCcw size={16} /></button>}
        </div>)}
      </div> : <div className="file-empty-state"><span className="file-empty-icon">{trash ? <Trash2 size={21} /> : <Folder size={21} />}</span><b>{trash ? "A lixeira está vazia" : search ? "Nenhum arquivo encontrado" : "Esta pasta está vazia"}</b><span>{trash ? "Os arquivos removidos aparecerão aqui." : "Envie um arquivo ou crie um documento para começar."}</span>{!trash && <button className="text-button" onClick={() => void createTextDocument()}>Criar documento <ChevronRight size={14} /></button>}</div>}
      <div className="file-list-footer"><span>{files.length} {files.length === 1 ? "arquivo" : "arquivos"}</span><span>Membros do espaço podem visualizar e editar</span></div>
    </div>
    <div className="files-tool-heading"><div><p className="eyebrow">FERRAMENTAS DO ESPAÇO</p><h2>Abra e edite no navegador</h2></div><span>Planilhas e PDF chegam em próximas atualizações</span></div>
    <div className="files-tool-grid file-tools-active"><article className="file-tool-card panel"><div className="file-tool-icon file-tool-documents"><FileText size={21} /></div><div className="file-tool-copy"><p className="eyebrow">EDITOR DE TEXTO</p><h3>Texto</h3><p>Crie e edite documentos no navegador, com salvamento compartilhado e histórico de versões.</p></div><div className="file-tool-bottom"><span className="file-format-list">DOCX · ODT · RTF · TXT</span><span className="file-tool-ready"><Check size={14} /> Disponível</span></div></article>
      <article className="file-tool-card panel"><div className="file-tool-icon file-tool-spreadsheets"><FileText size={21} /></div><div className="file-tool-copy"><p className="eyebrow">PLANILHAS</p><h3>Planilhas</h3><p>Os arquivos podem ser armazenados e baixados. O editor de planilhas será integrado em outra atualização.</p></div><div className="file-tool-bottom"><span className="file-format-list">XLSX · ODS · CSV</span><span className="coming-soon-badge">Em preparação</span></div></article>
      <article className="file-tool-card panel"><div className="file-tool-icon file-tool-pdf"><FileText size={21} /></div><div className="file-tool-copy"><p className="eyebrow">LEITURA E EDIÇÃO</p><h3>PDF</h3><p>Os PDFs ficam na biblioteca para baixar. Recursos de visualização e edição vêm depois.</p></div><div className="file-tool-bottom"><span className="file-format-list">PDF</span><span className="coming-soon-badge">Em preparação</span></div></article></div>
    <aside className="files-privacy-note"><ShieldCheck size={17} /><span><b>Privacidade do espaço</b><small>O conteúdo fica na pasta gama-work-files do Drive da proprietária e é entregue apenas a membros autenticados deste espaço. Cada envio aceita até 20 MB.</small></span></aside>
    {versionsFile && <FileVersionsDialog workspaceId={workspace.id} file={versionsFile} onClose={() => setVersionsFile(null)} onRestore={async () => { setVersionsFile(null); await load(); onNotice("Uma nova versão foi restaurada."); }} />}
    {moveFile && <div className="overlay" role="presentation" onClick={() => setMoveFile(null)}><section className="modal file-move-modal" role="dialog" aria-modal="true" aria-labelledby="move-file-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">ORGANIZAR ARQUIVOS</p><h2 id="move-file-title">Mover arquivo</h2></div><button className="icon-button" onClick={() => setMoveFile(null)} aria-label="Fechar"><X size={18} /></button></div><div className="modal-body"><p className="modal-intro">Escolha a pasta de destino para <b>{moveFile.name}</b>.</p><label className="field-label">Pasta de destino<select className="styled-select" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}><option value="">Arquivos (raiz)</option>{folderOptions.filter((option) => option.id !== moveFile.folder_id).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><div className="modal-actions"><button className="button button-secondary" onClick={() => setMoveFile(null)}>Cancelar</button><button className="button button-primary" onClick={() => void moveSelected()}>Mover arquivo</button></div></div></section></div>}
  </div>;
}

function LocalFilesPanel({ workspace, files, onFilesChanged, onNotice, onOpenEditor }: {
  workspace: Workspace;
  files: LocalWorkspaceFile[];
  onFilesChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onOpenEditor: (fileId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function storeFile(blob: Blob, name: string, contentType: string) {
    if (blob.size > 20 * 1024 * 1024) throw new Error("O arquivo ultrapassa o limite de 20 MB.");
    const time = Date.now();
    const id = crypto.randomUUID();
    await saveLocalFile({ id, workspaceId: workspace.id, name, contentType: contentType || "application/octet-stream", size: blob.size, currentVersion: 1, createdAt: time, updatedAt: time, bytes: bytesBuffer(new Uint8Array(await blob.arrayBuffer())) });
    return id;
  }
  async function uploadSelected(file?: File | null) {
    if (!file) return;
    setBusy(true); setError("");
    try { await storeFile(file, file.name, file.type); await onFilesChanged(); onNotice("Arquivo salvo apenas neste navegador."); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível salvar localmente."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function createTextDocument() {
    setBusy(true); setError("");
    try { const blob = await blankDocx(); const id = await storeFile(blob, "Novo documento.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); await onFilesChanged(); onOpenEditor(id); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível criar o documento local."); }
    finally { setBusy(false); }
  }
  function download(file: LocalWorkspaceFile) {
    downloadBlob(new Blob([file.bytes], { type: file.contentType }), file.name);
  }
  async function remove(file: LocalWorkspaceFile) {
    if (!window.confirm(`Excluir a cópia local “${file.name}” deste navegador?`)) return;
    await deleteLocalFile(file.id); await onFilesChanged(); onNotice("Cópia local removida.");
  }
  function openSyncSettings() {
    window.history.pushState({}, "", "/acesso/equipe?tab=sync");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  return <div className="page files-page">
    <div className="page-heading files-heading"><div><p className="eyebrow">ARQUIVOS DA EQUIPE</p><h1>Arquivos do espaço</h1><p className="page-intro">Biblioteca do espaço <b>{workspace.name}</b>.</p></div>
      <div className="file-toolbar-actions"><button className="button button-secondary" onClick={createTextDocument} disabled={busy}><Plus size={16} /> Novo documento local</button><button className="button button-primary" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} /> {busy ? "Salvando…" : "Guardar neste navegador"}</button><input ref={input} className="visually-hidden" type="file" onChange={(event) => void uploadSelected(event.target.files?.[0])} /></div>
    </div>
    <section className="panel local-storage-panel">
      <div className="local-storage-banner"><span className="local-storage-icon"><CloudOff size={20} /></span><div><b>Drive não conectado · modo local</b><p>Os arquivos abaixo ficam somente neste navegador. A equipe não consegue acessá-los, e eles não têm backup automático.</p></div>{workspace.role === "owner" ? <button className="button button-secondary" onClick={openSyncSettings}><HardDrive size={15} /> Conectar Drive</button> : <span className="local-owner-note">A proprietária pode ativar a sincronização em Espaço e equipe.</span>}</div>
      {error && <div className="form-error file-error" role="alert">{error}</div>}
      {files.length ? <div className="file-list">{files.map((file) => <div className="file-list-row" key={file.id}>
        <button className="file-main-cell" onClick={() => onOpenEditor(file.id)}><span className="file-row-icon document"><FileText size={18} /></span><span className="file-row-copy"><b>{file.name}</b><small>{formatBytes(file.size)} · salvo neste navegador</small></span></button><span className="file-list-meta">{formatBytes(file.size)}</span><span className="file-list-meta">{formatDate(file.updatedAt)}</span><div className="file-row-actions"><button className="icon-button" aria-label={`Baixar ${file.name}`} onClick={() => download(file)}><ArrowDownToLine size={17} /></button><button className="icon-button" aria-label={`Excluir ${file.name}`} onClick={() => void remove(file)}><Trash2 size={16} /></button></div>
      </div>)}</div> : <div className="file-empty-state"><span className="file-empty-icon"><HardDrive size={21} /></span><b>Nenhum arquivo local</b><span>Crie um documento ou escolha um arquivo para guardar neste navegador.</span></div>}
      <div className="file-list-footer"><span>{files.length} {files.length === 1 ? "arquivo local" : "arquivos locais"}</span><span>Para levar a outro dispositivo, baixe os arquivos.</span></div>
    </section>
    <aside className="files-privacy-note"><ShieldCheck size={17} /><span><b>Armazenamento deste navegador</b><small>Apagar os dados do navegador pode remover essas cópias. Baixe os arquivos para manter uma cópia independente.</small></span></aside>
  </div>;
}

function FileVersionsDialog({ workspaceId, file, onClose, onRestore }: { workspaceId: string; file: WorkspaceFile; onClose: () => void; onRestore: () => Promise<void> }) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ versions: FileVersion[] }>(`workspaces/${workspaceId}/files/${file.id}/versions`).then((result) => setVersions(result.versions)).catch((issue) => setError(message(issue))); }, [file.id, workspaceId]);
  async function restore(version: FileVersion) {
    if (version.version_number === file.current_version) return;
    setBusy(true);
    try { await api(`workspaces/${workspaceId}/files/${file.id}/restore/${version.version_number}`, json({})); await onRestore(); }
    catch (issue) { setError(message(issue)); }
    finally { setBusy(false); }
  }
  return <div className="overlay" role="presentation" onClick={onClose}><section className="modal file-versions-modal" role="dialog" aria-modal="true" aria-labelledby="versions-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">HISTÓRICO</p><h2 id="versions-title">Versões do arquivo</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><div className="modal-body"><p className="modal-intro"><b>{file.name}</b> · cada salvamento cria uma versão recuperável.</p>{error && <div className="form-error">{error}</div>}<div className="version-list">{versions.map((version) => <div className="version-row" key={version.id}><span className="version-number">v{version.version_number}</span><span className="version-copy"><b>{version.version_number === file.current_version ? "Versão atual" : `Versão ${version.version_number}`}</b><small>{formatDate(version.created_at, { dateStyle: "medium", timeStyle: "short" })} · {version.created_by_name || "Membro da equipe"} · {formatBytes(version.size)}</small></span><button className="icon-button" title="Baixar esta versão" onClick={() => void downloadFile(workspaceId, file, version.version_number)}><ArrowDownToLine size={16} /></button>{version.version_number !== file.current_version && <button className="text-button" disabled={busy} onClick={() => void restore(version)}><RotateCcw size={14} /> Restaurar</button>}</div>)}</div><div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Fechar</button></div></div></section></div>;
}

async function blankDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function message(issue: unknown) { return issue instanceof Error ? issue.message : "Não foi possível concluir esta ação."; }
function viewUrl() { return "/acesso/arquivos"; }

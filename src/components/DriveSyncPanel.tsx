import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Cloud, ExternalLink, HardDrive, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type { Workspace } from "../types";

interface DriveStatus {
  available: boolean;
  connected: boolean;
  isOwner: boolean;
  ownerConnected: boolean;
  googleEmail: string | null;
  connectedByName: string | null;
  folderName: string;
}

const callbackMessages: Record<string, string> = {
  connected: "Google Drive conectado. Os arquivos deste espaço serão sincronizados na pasta gama-work-files.",
  cancelled: "A conexão com o Google Drive foi cancelada.",
  invalid: "Não foi possível validar o retorno do Google. Tente conectar novamente.",
  error: "Não foi possível conectar o Google Drive. Confira a configuração OAuth e tente novamente.",
  token_error: "O Google não concluiu a autorização. Tente novamente.",
  account_error: "Não foi possível confirmar a conta Google selecionada.",
  account_mismatch: "Este espaço já está vinculado a outra conta Google. A conexão atual foi preservada.",
  refresh_token_missing: "O Google não forneceu uma autorização persistente. Tente novamente e aceite a permissão solicitada.",
  scope_missing: "O Google não concedeu acesso aos arquivos do Gama Work. Conecte novamente e aceite essa permissão.",
  owner_changed: "A proprietária do espaço mudou. A nova proprietária deve conectar o Drive.",
};

export function DriveSyncPanel({ workspace, onNotice }: { workspace: Workspace; onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try { setStatus(await api<DriveStatus>(`workspaces/${workspace.id}/drive`)); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível consultar a sincronização."); }
  }, [workspace.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("drive");
    if (!result) return;
    onNotice(callbackMessages[result] ?? callbackMessages.error);
    url.searchParams.delete("drive");
    url.searchParams.delete("driveMessage");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void refresh();
  }, [onNotice, refresh]);

  async function connect() {
    setBusy(true); setError("");
    try {
      const result = await api<{ authorizationUrl: string }>(`workspaces/${workspace.id}/drive/connect`, { method: "POST" });
      window.location.assign(result.authorizationUrl);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível iniciar a conexão Google."); }
    finally { setBusy(false); }
  }

  const ownerNeedsReconnect = Boolean(status?.connected && !status.ownerConnected);
  return <section className="panel settings-card drive-sync-card">
    <div className="section-title"><div><h2>Sincronização com Google Drive</h2><p>Os arquivos compartilhados do espaço ficam na conta Google da proprietária.</p></div><span className={`drive-status-icon ${status?.connected && status.ownerConnected ? "connected" : ""}`}>{status?.connected && status.ownerConnected ? <CheckCircle2 size={20} /> : <Cloud size={20} />}</span></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!status ? <div className="drive-status-loading"><LoaderCircle size={16} className="spin" /> Consultando conexão…</div> : <>
      {!status.available && <div className="drive-setup-notice"><AlertCircle size={17} /><span><b>Conexão Google aguardando configuração</b><small>A administração da plataforma precisa cadastrar o OAuth do Google e a URL de retorno para ativar o Drive.</small></span></div>}
      {status.connected && status.ownerConnected ? <div className="drive-connected-box"><div><b>Drive conectado</b><small>{status.isOwner ? status.googleEmail : `Conectado por ${status.connectedByName ?? "a proprietária"}`}</small></div><span className="drive-folder-path"><HardDrive size={15} /> Meu Drive / {status.folderName} / {workspace.name}</span></div>
        : ownerNeedsReconnect ? <div className="drive-setup-notice"><AlertCircle size={17} /><span><b>Drive conectado pela proprietária anterior</b><small>Os arquivos continuam na conta Google vinculada{status.isOwner && status.googleEmail ? ` (${status.googleEmail})` : ""}. Para trocar a conta, primeiro será necessário migrar os arquivos.</small></span></div>
          : <div className="drive-setup-notice"><Cloud size={17} /><span><b>Arquivos compartilhados ainda não sincronizados</b><small>Sem a conexão, cada pessoa usa cópias locais no próprio navegador. A proprietária pode conectar o Drive para ativar a biblioteca compartilhada.</small></span></div>}
      <div className="drive-sync-details">
        <p><ShieldCheck size={15} /> O Gama Work acessa somente arquivos que cria na pasta da plataforma. A equipe usa os arquivos pelo espaço e não precisa vincular o Drive pessoal.</p>
        <p><HardDrive size={15} /> O espaço e o histórico de versões contam na cota da conta Google conectada. As versões mantidas para restauração também ocupam armazenamento no Drive.</p>
      </div>
      {status.isOwner && status.available && status.ownerConnected && <div className="form-actions drive-sync-actions"><span>{status.connected ? "Reconecte a mesma conta para renovar a autorização." : "Se você já entrou com Google, a conta será sugerida; ainda será necessário aceitar a permissão do Drive."}</span><button className="button button-primary" onClick={() => void connect()} disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" /> Abrindo Google…</> : <><GoogleMark /> {status.connected ? "Reconectar Google Drive" : "Conectar Google Drive"}</>}</button></div>}
      {!status.isOwner && <p className="muted-copy">Somente a proprietária pode conectar o Google Drive deste espaço.</p>}
    </>}
    <a className="drive-help-link" href="https://support.google.com/drive/answer/6374270" target="_blank" rel="noreferrer">Entenda o armazenamento da sua conta Google <ExternalLink size={13} /></a>
  </section>;
}

function GoogleMark() { return <span className="google-mark" aria-hidden="true">G</span>; }

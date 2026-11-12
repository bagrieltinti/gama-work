import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Activity, Building2, CheckCircle2, Search, ShieldCheck, UsersRound, UserRound, Files, LockKeyhole } from "lucide-react";
import { api, formatDate } from "../lib/api";
import type { AppUser } from "../types";

type Tab = "overview" | "users" | "workspaces" | "audit";
interface Overview {
  stats: { users: number; workspaces: number; activeWorkspaces: number; clients: number; files: number };
  recent: AuditEntry[];
}
interface UserRow { id: string; name: string; email: string; created_at: number; status: "active" | "suspended"; reason: string; workspace_count: number; owned_workspace_count: number }
interface WorkspaceRow { id: string; name: string; description: string; owner_name: string; owner_email: string; status: "active" | "suspended"; reason: string; member_count: number; client_count: number; file_count: number; created_at: number }
interface AuditEntry { id: string; action: string; target_type: string; target_id: string; details_json: string; created_at: number; actor_name: string; actor_email: string }

export function PlatformAdminPage({ user }: { user: AppUser }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (tab === "overview") setOverview(await api<Overview>("platform-admin/overview"));
      if (tab === "users") setUsers((await api<{ users: UserRow[] }>(`platform-admin/users?q=${encodeURIComponent(query)}`)).users);
      if (tab === "workspaces") setWorkspaces((await api<{ workspaces: WorkspaceRow[] }>(`platform-admin/workspaces?q=${encodeURIComponent(query)}`)).workspaces);
      if (tab === "audit") setAudit((await api<{ entries: AuditEntry[] }>("platform-admin/audit?limit=100")).entries);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível carregar os dados administrativos."); }
    finally { setLoading(false); }
  }, [query, tab]);
  useEffect(() => { void load(); }, [load]);

  async function updateStatus(type: "users" | "workspaces", row: UserRow | WorkspaceRow) {
    const suspended = row.status !== "suspended";
    const reason = suspended ? window.prompt(`Motivo para suspender ${type === "users" ? "a conta" : "o espaço"} “${type === "users" ? (row as UserRow).email : row.name}” (opcional):`, "") : "";
    if (reason === null) return;
    setBusyId(row.id); setError(""); setNotice("");
    try {
      await api(`platform-admin/${type}/${row.id}/status`, { method: "PATCH", body: JSON.stringify({ status: suspended ? "suspended" : "active", reason }) });
      setNotice(suspended ? (type === "users" ? "Conta suspensa e sessões encerradas." : "Espaço suspenso.") : (type === "users" ? "Conta reativada." : "Espaço reativado."));
      await load();
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível atualizar o acesso."); }
    finally { setBusyId(""); }
  }

  const tabs: Array<{ id: Tab; title: string; icon: typeof ShieldCheck }> = [
    { id: "overview", title: "Visão geral", icon: Activity },
    { id: "users", title: "Contas", icon: UsersRound },
    { id: "workspaces", title: "Espaços", icon: Building2 },
    { id: "audit", title: "Atividade", icon: LockKeyhole },
  ];
  return <div className="page platform-admin-page">
    <div className="page-heading platform-admin-heading"><div><p className="eyebrow">CONTROLE DA PLATAFORMA</p><h1>Administração</h1><p className="page-intro">Visão global de contas e espaços do Gama Work. Sua conta: <b>{user.email}</b></p></div><span className="platform-admin-badge"><ShieldCheck size={15} /> Admin da plataforma</span></div>
    <div className="platform-admin-tabs">{tabs.map(({ id, title, icon: Icon }) => <button key={id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}><Icon size={16} />{title}</button>)}</div>
    {(tab === "users" || tab === "workspaces") && <label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "users" ? "Buscar conta por nome ou e-mail" : "Buscar espaço ou proprietária"} /></label>}
    {error && <div className="form-error admin-message" role="alert">{error}</div>}
    {notice && <div className="admin-success" role="status"><CheckCircle2 size={16} /> {notice}</div>}
    {loading ? <div className="admin-loading"><span className="file-spinner" />Carregando dados administrativos…</div> : <>
      {tab === "overview" && overview && <>
        <div className="admin-stat-grid"><AdminStat title="Contas" value={overview.stats.users} caption="cadastros totais" icon={<UsersRound />} /><AdminStat title="Espaços ativos" value={overview.stats.activeWorkspaces} caption={`${overview.stats.workspaces} criados`} icon={<Building2 />} /><AdminStat title="Clientes" value={overview.stats.clients} caption="somados entre espaços" icon={<UserRound />} /><AdminStat title="Arquivos" value={overview.stats.files} caption="na biblioteca privada" icon={<Files />} /></div>
        <section className="panel admin-card"><div className="panel-head"><div><p className="eyebrow">TRILHA DE CONTROLE</p><h2>Atividade recente</h2></div><button className="text-button" onClick={() => setTab("audit")}>Ver tudo <Activity size={14} /></button></div>{overview.recent.length ? <AuditList entries={overview.recent} /> : <div className="admin-empty">As ações administrativas registradas aparecerão aqui.</div>}</section>
      </>}
      {tab === "users" && <section className="panel admin-card admin-table-card"><div className="panel-head"><div><p className="eyebrow">ACESSO À PLATAFORMA</p><h2>Contas registradas</h2><p>Até 200 resultados por busca. Suspender encerra as sessões ativas da conta.</p></div><span className="admin-result-count">{users.length} contas</span></div>{users.length ? <div className="admin-table"><div className="admin-table-head user-admin-grid"><span>CONTA</span><span>ESPAÇOS</span><span>CADASTRO</span><span>SITUAÇÃO</span><span /></div>{users.map((row) => <div className="admin-table-row user-admin-grid" key={row.id}><span className="admin-user-copy"><b>{row.name}</b><small>{row.email}</small></span><span className="admin-row-number">{row.owned_workspace_count} próprias · {row.workspace_count} acessos</span><span className="admin-row-date">{formatDate(row.created_at)}</span><span><StatusTag status={row.status} /></span><button className={`admin-action ${row.status === "suspended" ? "reactivate" : "suspend"}`} disabled={busyId === row.id || row.email.toLowerCase() === user.email.toLowerCase()} onClick={() => void updateStatus("users", row)}>{row.status === "suspended" ? "Reativar" : "Suspender"}</button></div>)}</div> : <div className="admin-empty">Nenhuma conta corresponde à busca.</div>}</section>}
      {tab === "workspaces" && <section className="panel admin-card admin-table-card"><div className="panel-head"><div><p className="eyebrow">ESPAÇOS DE EMPRESA</p><h2>Espaços criados</h2><p>Suspender bloqueia o acesso de todos os membros sem remover seus dados.</p></div><span className="admin-result-count">{workspaces.length} espaços</span></div>{workspaces.length ? <div className="admin-table"><div className="admin-table-head workspace-admin-grid"><span>ESPAÇO</span><span>MEMBROS E CLIENTES</span><span>ARQUIVOS</span><span>SITUAÇÃO</span><span /></div>{workspaces.map((row) => <div className="admin-table-row workspace-admin-grid" key={row.id}><span className="admin-user-copy"><b>{row.name}</b><small>Por {row.owner_name} · {row.owner_email}</small></span><span className="admin-row-number">{row.member_count} membros · {row.client_count} clientes</span><span className="admin-row-number">{row.file_count}</span><span><StatusTag status={row.status} /></span><button className={`admin-action ${row.status === "suspended" ? "reactivate" : "suspend"}`} disabled={busyId === row.id} onClick={() => void updateStatus("workspaces", row)}>{row.status === "suspended" ? "Reativar" : "Suspender"}</button></div>)}</div> : <div className="admin-empty">Nenhum espaço corresponde à busca.</div>}</section>}
      {tab === "audit" && <section className="panel admin-card"><div className="panel-head"><div><p className="eyebrow">REGISTRO DE AÇÕES</p><h2>Atividade administrativa</h2><p>As ações de suspensão e reativação ficam registradas para auditoria.</p></div></div>{audit.length ? <AuditList entries={audit} /> : <div className="admin-empty">Ainda não há ações administrativas registradas.</div>}</section>}
    </>}
    <div className="admin-beta-note"><ShieldCheck size={16} /><span><b>Beta gratuita</b><small>O painel de administração não ativa cobrança nem altera a configuração gratuita da plataforma.</small></span></div>
  </div>;
}

function AdminStat({ title, value, caption, icon }: { title: string; value: number; caption: string; icon: ReactNode }) {
  return <section className="panel admin-stat-card"><span className="admin-stat-icon">{icon}</span><span className="admin-stat-title">{title}</span><strong>{value.toLocaleString("pt-BR")}</strong><small>{caption}</small></section>;
}

function StatusTag({ status }: { status: "active" | "suspended" }) {
  return <span className={`admin-status ${status === "active" ? "active" : "suspended"}`}><i />{status === "active" ? "Ativo" : "Suspenso"}</span>;
}

function AuditList({ entries }: { entries: AuditEntry[] }) {
  const label: Record<string, string> = { user_suspended: "Conta suspensa", user_reactivated: "Conta reativada", workspace_suspended: "Espaço suspenso", workspace_reactivated: "Espaço reativado" };
  return <div className="admin-audit-list">{entries.map((entry) => {
    let details: { email?: string; name?: string; reason?: string } = {};
    try { details = JSON.parse(entry.details_json) as typeof details; } catch { /* log legacy or malformed details safely */ }
    return <div className="admin-audit-row" key={entry.id}><span className="admin-audit-icon"><LockKeyhole size={14} /></span><span className="admin-audit-copy"><b>{label[entry.action] ?? entry.action}</b><small>{entry.target_type === "user" ? details.email || entry.target_id : details.name || entry.target_id}{details.reason ? ` · ${details.reason}` : ""}</small></span><span className="admin-audit-meta"><b>{entry.actor_name || entry.actor_email}</b><small>{formatDate(entry.created_at, { dateStyle: "medium", timeStyle: "short" })}</small></span></div>;
  })}</div>;
}

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, BriefcaseBusiness, CalendarDays,
  Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Command,
  FileUp, Filter, FolderKanban, LayoutDashboard, LogOut, Mail, Menu, MoreHorizontal, Plus,
  Search, Settings2, ShieldCheck, Sparkles, Tag, UsersRound, X,
} from "lucide-react";
import JSZip from "jszip";
import Papa from "papaparse";
import { AuthScreen } from "./components/AuthScreen";
import { BrandMark } from "./components/BrandMark";
import { api, downloadBlob, formatDate, formatTime, json, patchJson, toDateTimeLocal } from "./lib/api";
import { authClient } from "./lib/auth-client";
import { BETA_FREE_NOTICE, BETA_SPACE_LIMIT, FUTURE_PRICING_NOTICE } from "./lib/plan";
import type { AppUser, Client, GuestSeatSummary, Interaction, Invitation, JourneyTemplate, Member, ReceivedInvitation, Task, Workspace } from "./types";
import "./App.css";

type View = "home" | "invitations" | "clients" | "agenda" | "tasks" | "templates" | "settings";
type ModalState = { kind: "workspace" | "client" | "task" | "interaction" | "template" | "import" | "bootstrap-invite" | null; data?: unknown };
type InvitePreview = { workspace_name: string; email: string; role: string };
type BootstrapAdminInvite = { email: string; url: string };
const navigation: Array<{ id: View; title: string; icon: typeof LayoutDashboard }> = [
  { id: "home", title: "Visão geral", icon: LayoutDashboard },
  { id: "invitations", title: "Convites", icon: Mail },
  { id: "clients", title: "Clientes", icon: UsersRound },
  { id: "agenda", title: "Agenda", icon: CalendarDays },
  { id: "tasks", title: "Tarefas", icon: CheckCheck },
  { id: "templates", title: "Modelos", icon: FolderKanban },
];

const viewPaths: Record<View, string> = {
  home: "/acesso",
  invitations: "/acesso/convites",
  clients: "/acesso/clientes",
  agenda: "/acesso/agenda",
  tasks: "/acesso/tarefas",
  templates: "/acesso/modelos",
  settings: "/acesso/equipe",
};
const pathViews: Record<string, View> = Object.fromEntries(Object.entries(viewPaths).map(([view, path]) => [path, view])) as Record<string, View>;
function viewFromPath() { return pathViews[window.location.pathname.replace(/\/$/, "")] ?? "home"; }
function inviteCode() { return window.location.pathname.match(/^\/(?:acesso\/)?join\/([^/]+)/)?.[1] ?? ""; }

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [invitation, setInvitation] = useState<InvitePreview | null>(null);
  const [receivedInvitations, setReceivedInvitations] = useState<ReceivedInvitation[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState(localStorage.getItem("gama-work-active") || "");
  const [view, setView] = useState<View>(viewFromPath);
  const [modal, setModal] = useState<ModalState>({ kind: null });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const token = useMemo(inviteCode, []);

  const loadWorkspaces = useCallback(async () => {
    const response = await api<{ workspaces: Workspace[] }>("workspaces");
    setWorkspaces(response.workspaces);
    setActiveId((previous) => {
      const saved = localStorage.getItem("gama-work-active") || previous;
      const next = response.workspaces.some((space) => space.id === saved) ? saved : response.workspaces[0]?.id || "";
      if (next) localStorage.setItem("gama-work-active", next);
      return next;
    });
  }, []);

  const loadReceivedInvitations = useCallback(async () => {
    const response = await api<{ invitations: ReceivedInvitation[] }>("invites/received");
    setReceivedInvitations(response.invitations);
  }, []);

  const refreshApp = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<{ user: AppUser }>("me");
      setUser(me.user);
      if (token || new URLSearchParams(window.location.search).has("cadastro")) window.history.replaceState({}, "", "/acesso");
      await Promise.all([loadWorkspaces(), loadReceivedInvitations()]);
    } catch {
      setUser(null);
    } finally {
      setAuthReady(true);
      setLoading(false);
    }
  }, [loadReceivedInvitations, loadWorkspaces, token]);

  useEffect(() => {
    const syncView = () => setView(viewFromPath());
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch("/api/config").then((response) => response.json()).then((data) => setGoogleEnabled(Boolean(data.googleEnabled))).catch(() => {}),
      token ? fetch(`/api/invites/${token}`).then(async (response) => response.ok ? response.json() : null).then((data) => setInvitation(data?.invitation ?? null)).catch(() => {}) : Promise.resolve(),
    ]).finally(() => void refreshApp());
  }, [refreshApp, token]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function navigate(next: View) {
    setView(next);
    if (window.location.pathname !== viewPaths[next]) window.history.pushState({}, "", viewPaths[next]);
  }

  async function respondToInvitation(invitationId: string, action: "accept" | "decline") {
    await api(`invites/received/${invitationId}/respond`, json({ action }));
    await Promise.all([loadReceivedInvitations(), action === "accept" ? loadWorkspaces() : Promise.resolve()]);
  }

  if (!authReady || loading) return <div className="loading-screen"><BrandMark /><span>Preparando seu espaço…</span></div>;
  if (!user) return <AuthScreen googleEnabled={googleEnabled} invitation={invitation} onAuthenticated={refreshApp} />;
  if (!workspaces.length) return <WelcomeScreen user={user} invitations={receivedInvitations} onRespondInvitation={respondToInvitation} onCreate={() => setModal({ kind: "workspace" })} modal={modal} setModal={setModal} close={() => setModal({ kind: null })} onCreated={loadWorkspaces} onLogout={async () => { await authClient.signOut(); window.location.reload(); }} />;

  const active = workspaces.find((space) => space.id === activeId) ?? workspaces[0];
  return <WorkspaceShell
    user={user} workspaces={workspaces} active={active} view={view} setView={navigate}
    modal={modal} setModal={setModal} mobileNav={mobileNav} setMobileNav={setMobileNav}
    notice={notice} setNotice={setNotice} onSwitch={(id) => { setActiveId(id); localStorage.setItem("gama-work-active", id); }}
    invitations={receivedInvitations} onRespondInvitation={respondToInvitation}
    onReloadWorkspaces={loadWorkspaces} onLogout={async () => { await authClient.signOut(); window.location.reload(); }}
  />;
}

function WelcomeScreen({ user, invitations, onRespondInvitation, onCreate, modal, setModal, close, onCreated, onLogout }: { user: AppUser; invitations: ReceivedInvitation[]; onRespondInvitation: (id: string, action: "accept" | "decline") => Promise<void>; onCreate: () => void; modal: ModalState; setModal: (modal: ModalState) => void; close: () => void; onCreated: () => Promise<void>; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  async function createSpace(values: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await api<{ bootstrapAdminInvites?: BootstrapAdminInvite[] }>("workspaces", json(values));
      await onCreated();
      if (response.bootstrapAdminInvites?.length) setModal({ kind: "bootstrap-invite", data: response.bootstrapAdminInvites });
      else close();
    }
    finally { setBusy(false); }
  }
  return <main className="welcome-page"><div className="welcome-brand"><BrandMark /> <span>GAMA <b>WORK</b></span></div>
    <div className="welcome-card"><span className="welcome-icon"><BriefcaseBusiness /></span><p className="eyebrow">OLÁ, {user.name.split(" ")[0].toLocaleUpperCase("pt-BR")}</p>
      <h1>Comece pelo espaço da sua empresa.</h1><p>Crie um espaço para organizar clientes, agenda e tarefas da equipe. Você poderá renomear e personalizar a identidade quando quiser.</p>
      <button className="button button-primary" onClick={onCreate}><Plus size={17} /> Criar espaço da empresa</button>
      <div className="welcome-tip"><ShieldCheck size={16} /> Você pode criar até {BETA_SPACE_LIMIT} espaços próprios durante a fase de testes.</div>
      <button className="welcome-logout" onClick={onLogout}>Sair da conta</button>
    </div>
    <div className="welcome-invitations"><InvitationInbox invitations={invitations} onRespond={onRespondInvitation} /></div>
    <BetaPricingNotice className="welcome-pricing" />
    {modal.kind === "workspace" && <WorkspaceModal onClose={close} onSave={createSpace} saving={busy} />}
  </main>;
}

function InvitationsPage({ invitations, onRespond }: { invitations: ReceivedInvitation[]; onRespond: (id: string, action: "accept" | "decline") => Promise<void> }) {
  return <div className="page invitations-page">
    <div className="page-heading"><div><p className="eyebrow">ACESSOS</p><h1>Convites recebidos</h1><p className="page-intro">Revise cada convite antes de entrar em um espaço de trabalho.</p></div></div>
    <InvitationInbox invitations={invitations} onRespond={onRespond} />
  </div>;
}

function InvitationInbox({ invitations, onRespond }: { invitations: ReceivedInvitation[]; onRespond: (id: string, action: "accept" | "decline") => Promise<void> }) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function respond(invitation: ReceivedInvitation, action: "accept" | "decline") {
    setBusyId(invitation.id);
    setError("");
    try { await onRespond(invitation.id, action); }
    catch (issue) { setError(errorText(issue)); }
    finally { setBusyId(""); }
  }
  return <section className="panel invitation-inbox">
    <div className="section-title"><div><h2>Convites recebidos</h2><p>Você decide em quais espaços entrar.</p></div><span className="invite-lock"><Mail size={17} /></span></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {invitations.length ? <div className="received-invite-list">{invitations.map((invite) => <article className="received-invite-card" key={invite.id}>
      <span className="workspace-icon" style={{ background: invite.workspace_accent_color }}>{iconFor(invite.workspace_icon)}</span>
      <div className="received-invite-copy"><b>{invite.workspace_name}</b><small>Convidada por {invite.invited_by_name} · {invite.role === "admin" ? "Administradora" : "Colaboradora"}</small><small>Expira em {formatDate(invite.expires_at)}</small></div>
      <div className="received-invite-actions"><button className="button button-primary" disabled={busyId === invite.id} onClick={() => void respond(invite, "accept")}><Check size={15} /> Aceitar</button><button className="button button-secondary" disabled={busyId === invite.id} onClick={() => void respond(invite, "decline")}><X size={15} /> Recusar</button></div>
    </article>)}</div> : <div className="invite-inbox-empty"><span><Mail size={19} /></span><b>Nenhum convite pendente</b><small>Quando alguém convidar este e-mail para uma equipe, o convite aparecerá aqui.</small></div>}
  </section>;
}

function BetaPricingNotice({ className = "" }: { className?: string }) {
  return <aside className={`beta-pricing-notice ${className}`}><span className="eyebrow">FASE DE TESTES</span><b>{BETA_FREE_NOTICE}</b><p>{FUTURE_PRICING_NOTICE}</p></aside>;
}

function WorkspaceShell(props: {
  user: AppUser; workspaces: Workspace[]; active: Workspace; view: View; setView: (view: View) => void;
  modal: ModalState; setModal: (modal: ModalState) => void; mobileNav: boolean; setMobileNav: (value: boolean) => void;
  notice: string; setNotice: (message: string) => void; onSwitch: (id: string) => void;
  invitations: ReceivedInvitation[]; onRespondInvitation: (id: string, action: "accept" | "decline") => Promise<void>;
  onReloadWorkspaces: () => Promise<void>; onLogout: () => void;
}) {
  const { user, workspaces, active, view, setView, modal, setModal, notice, setNotice } = props;
  const [profileMenu, setProfileMenu] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [globalSearch, setGlobalSearch] = useState(false);
  const reload = () => setDataVersion((value) => value + 1);
  return <div className="app-frame" style={{ "--workspace-accent": active.accent_color } as React.CSSProperties}>
    <aside className={`sidebar ${props.mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand-row"><BrandMark /><span className="brand-word">GAMA <b>WORK</b></span><button className="icon-button mobile-close" onClick={() => props.setMobileNav(false)} aria-label="Fechar menu"><X size={18} /></button></div>
      <WorkspacePicker workspaces={workspaces} active={active} ownedSpaceCount={workspaces.filter((space) => space.role === "owner").length} onSwitch={props.onSwitch} onCreate={() => setModal({ kind: "workspace" })} />
      <div className="sidebar-divider" />
      <p className="nav-label">ESPAÇO DE TRABALHO</p>
      <nav className="main-nav">{navigation.map(({ id, title, icon: Icon }) => <button key={id} onClick={() => { setView(id); props.setMobileNav(false); }} className={`nav-item ${view === id ? "nav-item-active" : ""}`}><Icon size={18} strokeWidth={1.8} /><span>{title}</span>{id === "invitations" && props.invitations.length > 0 && <span className="invite-nav-count">{props.invitations.length}</span>}{id === "tasks" && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-grow" />
      <button className={`nav-item ${view === "settings" ? "nav-item-active" : ""}`} onClick={() => setView("settings")}><Settings2 size={18} /><span>Espaço e equipe</span></button>
      <div className="sidebar-footnote"><span className="footnote-orb"><Sparkles size={14} /></span><span><b>Um passo de cada vez.</b><small>Mais ferramentas chegam com o tempo.</small></span></div>
      <div className="profile-wrap"><button className="profile-button" onClick={() => setProfileMenu(!profileMenu)}><Avatar name={user.name} /><span className="profile-copy"><b>{user.name}</b><small>{user.email}</small></span><MoreHorizontal size={18} /></button>
        {profileMenu && <div className="profile-menu"><button onClick={props.onLogout}><LogOut size={15} /> Sair da conta</button></div>}
      </div>
    </aside>
    {props.mobileNav && <button className="mobile-scrim" onClick={() => props.setMobileNav(false)} aria-label="Fechar menu" />}
    <main className="main-panel">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => props.setMobileNav(true)} aria-label="Abrir menu"><Menu size={20} /></button>
        <div className="breadcrumbs"><span>{active.name}</span><ChevronRight size={14} /><b>{navigation.find((item) => item.id === view)?.title ?? "Configurações"}</b></div>
        <div className="topbar-actions"><button className="search-trigger" onClick={() => setGlobalSearch(true)}><Search size={16} /><span>Buscar</span><kbd><Command size={11} /> K</kbd></button><button className="icon-button topbar-help" aria-label="Ajuda"><CircleHelp size={18} /></button><Avatar name={user.name} small /></div>
      </header>
      <div className="content-area" key={`${active.id}-${view}`}>
        {view === "home" && <Dashboard user={user} workspace={active} version={dataVersion} setView={setView} setModal={setModal} />}
        {view === "invitations" && <InvitationsPage invitations={props.invitations} onRespond={props.onRespondInvitation} />}
        {view === "clients" && <ClientsPage workspace={active} version={dataVersion} setModal={setModal} />}
        {view === "agenda" && <AgendaPage workspace={active} user={user} version={dataVersion} setModal={setModal} />}
        {view === "tasks" && <TasksPage workspace={active} version={dataVersion} setModal={setModal} setNotice={setNotice} />}
        {view === "templates" && <TemplatesPage workspace={active} version={dataVersion} setModal={setModal} setNotice={setNotice} />}
        {view === "settings" && <SettingsPage workspace={active} user={user} version={dataVersion} setNotice={setNotice} setModal={setModal} reloadWorkspaces={props.onReloadWorkspaces} />}
      </div>
    </main>
    {modal.kind === "workspace" && <WorkspaceModal onClose={() => setModal({ kind: null })} onSave={async (values) => { const result = await api<{ workspace: Workspace }>("workspaces", json(values)); await props.onReloadWorkspaces(); props.onSwitch(result.workspace.id); setView("home"); reload(); setModal({ kind: null }); setNotice("Espaço criado."); }} />}
    {modal.kind === "bootstrap-invite" && <BootstrapAdminInviteModal invites={modal.data as BootstrapAdminInvite[]} onClose={() => setModal({ kind: null })} />}
    {modal.kind === "client" && <ClientModal workspace={active} data={modal.data as Client | undefined} onClose={() => setModal({ kind: null })} onSaved={() => { setModal({ kind: null }); reload(); setNotice(modal.data ? "Cliente atualizado." : "Cliente adicionado."); }} />}
    {modal.kind === "task" && <TaskModal workspace={active} data={modal.data as Task | undefined} onClose={() => setModal({ kind: null })} onSaved={() => { setModal({ kind: null }); reload(); setNotice("Item salvo na agenda."); }} />}
    {modal.kind === "interaction" && <InteractionModal workspace={active} client={modal.data as Client} onClose={() => setModal({ kind: null })} onEdit={() => setModal({ kind: "client", data: modal.data })} onSaved={() => { setModal({ kind: null }); reload(); setNotice("Atendimento registrado."); }} />}
    {modal.kind === "template" && <TemplateModal workspace={active} data={modal.data as JourneyTemplate | undefined} onClose={() => setModal({ kind: null })} onSaved={() => { setModal({ kind: null }); reload(); setNotice("Modelo salvo."); }} />}
    {modal.kind === "import" && <ImportModal workspace={active} onClose={() => setModal({ kind: null })} onImported={(count) => { setModal({ kind: null }); reload(); setNotice(`${count} clientes importados.`); }} />}
    {globalSearch && <SearchOverlay workspace={active} onClose={() => setGlobalSearch(false)} onOpenClient={(client) => { setGlobalSearch(false); setView("clients"); setModal({ kind: "client", data: client }); }} />}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
  </div>;
}

function WorkspacePicker({ workspaces, active, ownedSpaceCount, onSwitch, onCreate }: { workspaces: Workspace[]; active: Workspace; ownedSpaceCount: number; onSwitch: (id: string) => void; onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="workspace-picker-wrap"><button className="workspace-picker" onClick={() => setOpen(!open)}><span className="workspace-icon" style={{ background: active.accent_color }}>{iconFor(active.icon)}</span><span className="workspace-picker-copy"><b>{active.name}</b><small>{active.description || "Espaço da empresa"}</small></span><ChevronDown size={16} /></button>
    {open && <><button className="menu-dismiss" onClick={() => setOpen(false)} aria-label="Fechar seletor" /><div className="workspace-menu">{workspaces.map((space) => <button key={space.id} className={`workspace-option ${space.id === active.id ? "selected" : ""}`} onClick={() => { onSwitch(space.id); setOpen(false); }}><span className="workspace-icon small-icon" style={{ background: space.accent_color }}>{iconFor(space.icon)}</span><span><b>{space.name}</b><small>{space.role === "owner" ? "Proprietária" : space.role === "admin" ? "Administradora" : "Colaboradora"}</small></span>{space.id === active.id && <Check size={15} />}</button>)}
      <div className="workspace-limit-note">Espaços próprios: {ownedSpaceCount}/{BETA_SPACE_LIMIT}</div>
      {ownedSpaceCount < BETA_SPACE_LIMIT ? <button className="workspace-create-option" onClick={() => { setOpen(false); onCreate(); }}><Plus size={16} /> Criar espaço</button> : <div className="workspace-create-locked"><ShieldCheck size={15} /> Limite gratuito atingido</div>}</div></>}
  </div>;
}

function Dashboard({ user, workspace, version, setView, setModal }: { user: AppUser; workspace: Workspace; version: number; setView: (view: View) => void; setModal: (modal: ModalState) => void }) {
  const [clients, setClients] = useState<Client[]>([]); const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => { void Promise.all([api<{ clients: Client[] }>(`workspaces/${workspace.id}/clients`), api<{ tasks: Task[] }>(`workspaces/${workspace.id}/tasks`)]).then(([c, t]) => { setClients(c.clients); setTasks(t.tasks); }); }, [workspace.id, version]);
  const followups = clients.filter((client) => client.next_followup_at && client.next_followup_at <= Date.now() + 7 * 86400000).slice(0, 5);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const todayTasks = tasks.filter((task) => { const value = task.start_at || task.due_at; return value && new Date(value).toDateString() === new Date().toDateString(); });
  return <div className="page dashboard-page">
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date()).toLocaleUpperCase("pt-BR")}</p><h1>Bom trabalho, {user.name.split(" ")[0]}.</h1><p className="page-intro">Aqui está o que está acontecendo em <b>{workspace.name}</b>.</p></div><button className="button button-primary" onClick={() => setModal({ kind: "client" })}><Plus size={17} /> Novo cliente</button></div>
    <div className="quick-grid"><QuickStat label="Clientes" value={clients.length} detail="neste espaço" icon={<UsersRound size={18} />} onClick={() => setView("clients")} /><QuickStat label="Acompanhar" value={followups.length} detail="com retorno próximo" icon={<Activity size={18} />} onClick={() => setView("clients")} /><QuickStat label="Tarefas abertas" value={openTasks.length} detail="na equipe" icon={<CheckCheck size={18} />} onClick={() => setView("tasks")} /><QuickStat label="Na agenda hoje" value={todayTasks.length} detail="tarefas e encontros" icon={<CalendarDays size={18} />} onClick={() => setView("agenda")} /></div>
    <div className="dashboard-grid"><section className="panel attention-panel"><div className="panel-head"><div><p className="eyebrow">PARA ACOMPANHAR</p><h2>Próximos retornos</h2></div><button className="text-button" onClick={() => setView("clients")}>Ver clientes <ArrowRight size={15} /></button></div>
      {followups.length ? <div className="followup-list">{followups.map((client) => <button key={client.id} className="followup-row" onClick={() => { setView("clients"); setModal({ kind: "interaction", data: client }); }}><Avatar name={client.name} small /><span className="followup-person"><b>{client.name}</b><small>{client.product || "Cliente"}</small></span><span className="followup-date"><Clock3 size={13} /> {formatDate(client.next_followup_at)}</span><ChevronRight size={15} /></button>)}</div> : <EmptyState icon={<Sparkles />} title="Tudo em dia por aqui" detail="Novos retornos aparecerão nesta lista." />}</section>
      <section className="panel today-panel"><div className="panel-head"><div><p className="eyebrow">O DIA</p><h2>Agenda de hoje</h2></div><button className="icon-button" onClick={() => setModal({ kind: "task", data: { kind: "appointment" } })} aria-label="Adicionar compromisso"><Plus size={18} /></button></div>
        {todayTasks.length ? <div className="today-list">{todayTasks.slice(0, 4).map((task) => <div className="today-row" key={task.id}><span className={`event-marker ${task.kind}`} /><span><b>{task.title}</b><small>{formatTime(task.start_at || task.due_at)}{task.client_name ? ` · ${task.client_name}` : ""}</small></span></div>)}</div> : <EmptyState icon={<CalendarDays />} title="Agenda livre" detail="Adicione um compromisso ou tarefa." action={<button className="text-button" onClick={() => setModal({ kind: "task", data: { kind: "appointment" } })}>Adicionar à agenda <ArrowRight size={14} /></button>} />}</section>
    </div>
    <section className="start-panel"><div className="start-symbol"><Sparkles size={22} /></div><div><p className="eyebrow">COMECE PELO QUE IMPORTA</p><h2>Um espaço organizado, do seu jeito.</h2><p>Cadastre clientes, registre conversas e reúna os próximos passos da equipe em um só lugar.</p></div><div className="start-actions"><button onClick={() => setView("clients")}><UsersRound size={16} /> Ver clientes</button><button onClick={() => setView("settings")}><Settings2 size={16} /> Personalizar espaço</button></div></section>
  </div>;
}

function QuickStat({ label, value, detail, icon, onClick }: { label: string; value: number; detail: string; icon: ReactNode; onClick: () => void }) { return <button className="quick-stat" onClick={onClick}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small><ChevronRight className="stat-arrow" size={15} /></button>; }

function ClientsPage({ workspace, version, setModal }: { workspace: Workspace; version: number; setModal: (modal: ModalState) => void }) {
  const [clients, setClients] = useState<Client[]>([]); const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [loading, setLoading] = useState(true);
  const load = useCallback(() => { setLoading(true); void api<{ clients: Client[] }>(`workspaces/${workspace.id}/clients`).then((response) => setClients(response.clients)).finally(() => setLoading(false)); }, [workspace.id]);
  useEffect(load, [load, version]);
  const filtered = clients.filter((client) => (status === "all" || client.status === status) && `${client.name} ${client.email ?? ""} ${client.product}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">RELACIONAMENTO</p><h1>Clientes</h1><p className="page-intro">Acompanhe contatos, histórico e próximos passos do seu espaço.</p></div><button className="button button-primary" onClick={() => setModal({ kind: "client" })}><Plus size={17} /> Adicionar cliente</button></div>
    <section className="panel table-panel"><div className="toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar clientes" /></div><div className="toolbar-right"><span className="result-count">{filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}</span><label className="select-wrap"><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="discontinued">Encerrados</option></select><ChevronDown size={14} /></label></div></div>
      {loading ? <LoadingRows /> : filtered.length ? <div className="client-table"><div className="table-header"><span>CLIENTE</span><span>PRODUTO / SERVIÇO</span><span>STATUS</span><span>PRÓXIMO RETORNO</span><span /></div>{filtered.map((client) => <button className="client-row" key={client.id} onClick={() => setModal({ kind: "interaction", data: client })}><span className="client-name-cell"><Avatar name={client.name} small /><span><b>{client.name}</b><small>{client.email || client.phone || "Sem contato cadastrado"}</small></span></span><span className="product-cell">{client.product || <i>Não informado</i>}{client.is_fidelized ? <em className="fidelized-tag"><Tag size={11} /> Fidelizado</em> : null}</span><span><StatusBadge status={client.status} /></span><span className="table-date">{formatDate(client.next_followup_at)}</span><MoreHorizontal size={17} className="row-more" /></button>)}</div> : <EmptyState icon={<UsersRound />} title="Nenhum cliente por enquanto" detail={query ? "Tente outro termo de busca." : "Adicione seu primeiro cliente ou importe uma lista existente."} action={!query && <div className="empty-actions"><button className="button button-secondary" onClick={() => setModal({ kind: "import" })}><FileUp size={16} /> Importar clientes</button><button className="button button-primary" onClick={() => setModal({ kind: "client" })}><Plus size={16} /> Adicionar cliente</button></div>} />}
    </section>
    {clients.length > 0 && <div className="list-footer"><span>Os dados são exclusivos de {workspace.name}.</span><button className="text-button" onClick={() => setModal({ kind: "import" })}><FileUp size={15} /> Importar clientes</button></div>}
  </div>;
}

function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status}`}>{status === "active" ? "Ativo" : status === "paused" ? "Pausado" : "Encerrado"}</span>; }

function AgendaPage({ workspace, user, version, setModal }: { workspace: Workspace; user: AppUser; version: number; setModal: (modal: ModalState) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [scope, setScope] = useState<"all" | "shared" | "personal">("all"); const [date, setDate] = useState(new Date()); const [loading, setLoading] = useState(true);
  useEffect(() => { void api<{ tasks: Task[] }>(`workspaces/${workspace.id}/tasks`).then((response) => setTasks(response.tasks)).finally(() => setLoading(false)); }, [workspace.id, version]);
  const visible = tasks.filter((task) => scope === "all" || (scope === "shared" ? Boolean(task.is_shared) : !task.is_shared));
  const week = getWeek(date); const entries = visible.filter((task) => { const stamp = task.start_at || task.due_at; return stamp && new Date(stamp).toDateString() === date.toDateString(); }).sort((a, b) => (a.start_at || a.due_at || 0) - (b.start_at || b.due_at || 0));
  function shiftWeek(direction: number) { const next = new Date(date); next.setDate(next.getDate() + direction * 7); setDate(next); }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">TEMPO DA EQUIPE</p><h1>Agenda</h1><p className="page-intro">Compromissos compartilhados e seus itens pessoais, juntos quando você precisa.</p></div><button className="button button-primary" onClick={() => setModal({ kind: "task", data: { kind: "appointment" } })}><Plus size={17} /> Novo compromisso</button></div>
    <div className="agenda-layout"><section className="panel calendar-panel"><div className="calendar-top"><div><p className="eyebrow">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date).toLocaleUpperCase("pt-BR")}</p><h2>Semana de {formatDate(week[0].getTime(), { day: "numeric", month: "long" })}</h2></div><div className="calendar-nav"><button className="icon-button" onClick={() => shiftWeek(-1)} aria-label="Semana anterior"><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setDate(new Date())}>Hoje</button><button className="icon-button" onClick={() => shiftWeek(1)} aria-label="Próxima semana"><ChevronRight size={17} /></button></div></div>
      <div className="week-strip">{week.map((day) => <button key={day.toDateString()} className={`week-day ${day.toDateString() === date.toDateString() ? "week-day-active" : ""} ${day.toDateString() === new Date().toDateString() ? "week-day-today" : ""}`} onClick={() => setDate(day)}><small>{new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day).replace(".", "")}</small><b>{day.getDate()}</b><span /></button>)}</div>
      <div className="scope-tabs"><button className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>Tudo</button><button className={scope === "shared" ? "selected" : ""} onClick={() => setScope("shared")}>Equipe</button><button className={scope === "personal" ? "selected" : ""} onClick={() => setScope("personal")}>Pessoal</button><span className="scope-caption"><span className="scope-dot shared-dot" /> Compartilhado <span className="scope-dot personal-dot" /> Pessoal</span></div>
      <div className="agenda-day-title"><b>{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(date)}</b><span>{entries.length} itens</span></div>
      {loading ? <LoadingRows /> : entries.length ? <div className="agenda-events">{entries.map((task) => <button className={`agenda-event ${task.is_shared ? "event-shared" : "event-personal"}`} key={task.id} onClick={() => setModal({ kind: "task", data: task })}><div className="event-time">{formatTime(task.start_at || task.due_at)}{task.end_at && <small>{formatTime(task.end_at)}</small>}</div><span className={`event-color ${task.kind}`} /><div className="event-copy"><b>{task.title}</b><small>{task.client_name || (task.kind === "appointment" ? "Compromisso" : "Tarefa")} · {task.is_shared ? task.assigned_name || "Equipe" : user.name}</small></div><span className={`event-scope ${task.is_shared ? "shared" : "personal"}`}>{task.is_shared ? "Equipe" : "Pessoal"}</span><ChevronRight size={15} /></button>)}</div> : <EmptyState icon={<CalendarDays />} title="Nada marcado neste dia" detail="Adicione um compromisso compartilhado ou um lembrete pessoal." action={<button className="text-button" onClick={() => setModal({ kind: "task", data: { kind: "appointment", date } })}>Adicionar item <ArrowRight size={14} /></button>} />}
    </section><aside className="agenda-aside"><div className="panel agenda-side-card"><p className="eyebrow">VISÃO DA SEMANA</p><h2>Seus próximos passos</h2><div className="mini-agenda">{visible.filter((task) => { const stamp = task.start_at || task.due_at; return stamp && stamp >= Date.now() - 3600000; }).sort((a, b) => (a.start_at || a.due_at || 0) - (b.start_at || b.due_at || 0)).slice(0, 4).map((task) => <div className="mini-event" key={task.id}><span className={`mini-event-bar ${task.is_shared ? "shared" : "personal"}`} /><div><small>{formatDate(task.start_at || task.due_at)} · {formatTime(task.start_at || task.due_at)}</small><b>{task.title}</b></div></div>)}</div>{!visible.length && <p className="muted-copy">Sua agenda está pronta para receber os primeiros itens.</p>}<button className="button button-secondary button-full" onClick={() => setModal({ kind: "task", data: { kind: "task" } })}><Plus size={16} /> Nova tarefa</button></div><div className="privacy-note"><ShieldCheck size={17} /><span><b>Seus itens pessoais são privados.</b><small>Só você os vê. Os eventos da equipe ficam visíveis para todos do espaço.</small></span></div></aside></div>
  </div>;
}
function getWeek(date: Date) { const start = new Date(date); const weekday = (start.getDay() + 6) % 7; start.setDate(start.getDate() - weekday); start.setHours(0, 0, 0, 0); return Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; }); }

function TasksPage({ workspace, version, setModal, setNotice }: { workspace: Workspace; version: number; setModal: (modal: ModalState) => void; setNotice: (message: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [filter, setFilter] = useState("open");
  const refresh = useCallback(() => { void api<{ tasks: Task[] }>(`workspaces/${workspace.id}/tasks`).then((response) => setTasks(response.tasks)); }, [workspace.id]);
  useEffect(refresh, [refresh, version]);
  const visible = tasks.filter((task) => filter === "all" || (filter === "open" ? task.status !== "done" : task.status === filter));
  async function toggle(task: Task) { const next = task.status === "done" ? "open" : "done"; try { await api(`workspaces/${workspace.id}/tasks/${task.id}`, patchJson({ title: task.title, details: task.details, kind: task.kind, status: next, dueAt: task.due_at, startAt: task.start_at, endAt: task.end_at, clientId: task.client_id, isShared: Boolean(task.is_shared) })); refresh(); setNotice(next === "done" ? "Tarefa concluída." : "Tarefa reaberta."); } catch (e) { setNotice(errorText(e)); } }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">ORGANIZAÇÃO</p><h1>Tarefas</h1><p className="page-intro">Próximas ações da equipe e compromissos ligados aos clientes.</p></div><button className="button button-primary" onClick={() => setModal({ kind: "task", data: { kind: "task" } })}><Plus size={17} /> Nova tarefa</button></div>
    <section className="panel task-panel"><div className="scope-tabs task-filters"><button className={filter === "open" ? "selected" : ""} onClick={() => setFilter("open")}>Em aberto</button><button className={filter === "in_progress" ? "selected" : ""} onClick={() => setFilter("in_progress")}>Em andamento</button><button className={filter === "done" ? "selected" : ""} onClick={() => setFilter("done")}>Concluídas</button><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todas</button></div>
      {visible.length ? <div className="task-list">{visible.map((task) => <div className={`task-row ${task.status === "done" ? "task-done" : ""}`} key={task.id}><button className={`task-check ${task.status === "done" ? "checked" : ""}`} aria-label={task.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"} onClick={() => void toggle(task)}>{task.status === "done" && <Check size={13} />}</button><button className="task-main" onClick={() => setModal({ kind: "task", data: task })}><b>{task.title}</b><small>{task.details || task.client_name || "Sem detalhes"}</small></button><span className={`task-type type-${task.kind}`}>{task.kind === "appointment" ? <CalendarDays size={13} /> : <CheckCheck size={13} />}{task.kind === "appointment" ? "Compromisso" : "Tarefa"}</span><span className="task-date">{formatDate(task.start_at || task.due_at)}{(task.start_at || task.due_at) && <small>{formatTime(task.start_at || task.due_at)}</small>}</span><span className={`event-scope ${task.is_shared ? "shared" : "personal"}`}>{task.is_shared ? "Equipe" : "Pessoal"}</span><button className="icon-button" onClick={() => setModal({ kind: "task", data: task })} aria-label="Editar"><MoreHorizontal size={17} /></button></div>)}</div> : <EmptyState icon={<CheckCheck />} title="Tudo em ordem" detail="As tarefas que você adicionar aparecerão aqui." action={<button className="button button-secondary" onClick={() => setModal({ kind: "task", data: { kind: "task" } })}><Plus size={16} /> Criar tarefa</button>} />}
    </section></div>;
}

function TemplatesPage({ workspace, version, setModal, setNotice }: { workspace: Workspace; version: number; setModal: (modal: ModalState) => void; setNotice: (message: string) => void }) {
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const refresh = useCallback(() => { void api<{ templates: JourneyTemplate[] }>(`workspaces/${workspace.id}/templates`).then((response) => setTemplates(response.templates)); }, [workspace.id]);
  useEffect(refresh, [refresh, version]);
  async function toggle(template: JourneyTemplate) { try { await api(`workspaces/${workspace.id}/templates/${template.id}`, patchJson({ name: template.name, category: template.category, description: template.description, stages: parseStages(template.stages_json), isActive: !template.is_active })); refresh(); } catch (e) { setNotice(errorText(e)); } }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">PROCESSOS REUTILIZÁVEIS</p><h1>Modelos</h1><p className="page-intro">Crie jornadas editáveis e adapte cada processo à realidade do espaço.</p></div><button className="button button-primary" onClick={() => setModal({ kind: "template" })}><Plus size={17} /> Criar modelo</button></div>
    <div className="template-intro"><span className="template-spark"><Sparkles size={19} /></span><p><b>Comece com uma estrutura simples.</b><span>Os modelos podem ser editados a qualquer momento e reutilizados em diferentes situações.</span></p><button className="text-button" onClick={() => setModal({ kind: "template" })}>Personalizar <ArrowRight size={14} /></button></div>
    <div className="template-grid">{templates.map((template, index) => { const stages = parseStages(template.stages_json); return <article className={`template-card ${!template.is_active ? "template-inactive" : ""}`} key={template.id}><div className="template-card-top"><span className={`template-icon template-tone-${index % 4}`}><FolderKanban size={18} /></span><span className="template-category">{template.category}</span><button className="icon-button" onClick={() => setModal({ kind: "template", data: template })} aria-label="Editar modelo"><MoreHorizontal size={18} /></button></div><h2>{template.name}</h2><p>{template.description || "Sem descrição"}</p><div className="stage-preview">{stages.slice(0, 5).map((stage, i) => <span key={`${String(stage)}-${i}`}>{typeof stage === "string" ? stage : `Etapa ${i + 1}`}</span>)}{stages.length > 5 && <small>+{stages.length - 5}</small>}</div><div className="template-card-foot"><span className={template.is_active ? "template-active" : "template-archived"}>{template.is_active ? "Disponível para uso" : "Arquivado"}</span><button className="text-button" onClick={() => void toggle(template)}>{template.is_active ? "Arquivar" : "Reativar"}</button></div></article>; })}</div>
  </div>;
}
function parseStages(value: string) { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }

function SettingsPage({ workspace, user, version, setNotice, setModal, reloadWorkspaces }: { workspace: Workspace; user: AppUser; version: number; setNotice: (message: string) => void; setModal: (modal: ModalState) => void; reloadWorkspaces: () => Promise<void> }) {
  const [form, setForm] = useState({ name: workspace.name, description: workspace.description, icon: workspace.icon, accentColor: workspace.accent_color });
  const [members, setMembers] = useState<Member[]>([]); const [invites, setInvites] = useState<Invitation[]>([]); const [guestSeats, setGuestSeats] = useState<GuestSeatSummary>({ active: 0, pending: 0, included: 3, used: 0, additional: 0 }); const [email, setEmail] = useState(""); const [role, setRole] = useState<"admin" | "collaborator">("collaborator"); const [deliveryMethod, setDeliveryMethod] = useState<"account" | "link">(workspace.role === "owner" ? "link" : "account"); const [busy, setBusy] = useState(false); const [tab, setTab] = useState<"space" | "team" | "data">("space");
  const isOwner = workspace.role === "owner"; const canManageTeam = isOwner || workspace.role === "admin";
  const refresh = useCallback(async () => { const data = await api<{ members: Member[]; guestSeats: GuestSeatSummary }>(`workspaces/${workspace.id}/members`); setMembers(data.members); setGuestSeats(data.guestSeats); if (canManageTeam) { const response = await api<{ invitations: Invitation[] }>(`workspaces/${workspace.id}/invites`); setInvites(response.invitations); } else setInvites([]); }, [workspace.id, canManageTeam]);
  useEffect(() => {
    const openImport = () => setModal({ kind: "import" });
    window.addEventListener("gama:import", openImport);
    return () => window.removeEventListener("gama:import", openImport);
  }, [setModal]);
  useEffect(() => { setForm({ name: workspace.name, description: workspace.description, icon: workspace.icon, accentColor: workspace.accent_color }); setDeliveryMethod(workspace.role === "owner" ? "link" : "account"); void refresh(); }, [workspace.id, workspace.name, workspace.description, workspace.icon, workspace.accent_color, workspace.role, refresh, version]);
  async function saveSpace(event: FormEvent) { event.preventDefault(); setBusy(true); try { await api(`workspaces/${workspace.id}`, patchJson(form)); await reloadWorkspaces(); setNotice("Identidade do espaço atualizada."); } catch (e) { setNotice(errorText(e)); } finally { setBusy(false); } }
  async function createInvite(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await api<{ invitation: Invitation }>(`workspaces/${workspace.id}/invites`, json({ email, role, deliveryMethod })); setEmail(""); await refresh(); setInvites((current) => [result.invitation, ...current.filter((item) => item.id !== result.invitation.id)]); setNotice(result.invitation.url ? "Link único criado. Copie-o na lista de convites pendentes." : "Convite enviado à caixa da conta. A pessoa poderá aceitar ou recusar ao entrar."); } catch (e) { setNotice(errorText(e)); } finally { setBusy(false); } }
  async function setMemberRole(member: Member, newRole: string) { if (!window.confirm(newRole === "owner" ? `Transferir a propriedade para ${member.name}?` : `Alterar o papel de ${member.name}?`)) return; try { await api(`workspaces/${workspace.id}/members/${member.user_id}`, patchJson({ role: newRole })); await refresh(); await reloadWorkspaces(); setNotice(newRole === "owner" ? "Propriedade transferida." : "Papel atualizado."); } catch (e) { setNotice(errorText(e)); } }
  async function removeMember(member: Member) { if (!window.confirm(`Remover ${member.name} deste espaço?`)) return; try { await api(`workspaces/${workspace.id}/members/${member.user_id}`, { method: "DELETE" }); await refresh(); setNotice("Acesso removido."); } catch (e) { setNotice(errorText(e)); } }
  async function cancelInvite(invite: Invitation) { try { await api(`workspaces/${workspace.id}/invites/${invite.id}`, { method: "DELETE" }); setInvites((list) => list.filter((item) => item.id !== invite.id)); setNotice("Convite cancelado."); } catch (e) { setNotice(errorText(e)); } }
  async function copyInvite(invite: Invitation) { try { let url = invite.url; if (!url) { const result = await api<{ url: string; expiresAt: number }>(`workspaces/${workspace.id}/invites/${invite.id}/link`, { method: "POST" }); url = result.url; setInvites((list) => list.map((item) => item.id === invite.id ? { ...item, url, expiresAt: result.expiresAt } : item)); } await navigator.clipboard.writeText(url); setNotice("Link de convite copiado. Códigos anteriores desse convite deixam de funcionar."); } catch (e) { setNotice(errorText(e)); } }
  async function exportData(kind: "json" | "csv") { try { const response = await fetch(`/api/workspaces/${workspace.id}/clients/export.${kind}`, { credentials: "include" }); if (!response.ok) throw new Error("Não foi possível exportar este espaço."); downloadBlob(await response.blob(), `gama-work-${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${kind}`); } catch (e) { setNotice(errorText(e)); } }
  return <div className="page settings-page"><div className="page-heading"><div><p className="eyebrow">CONFIGURAÇÕES</p><h1>Espaço e equipe</h1><p className="page-intro">Gerencie o espaço <b>{workspace.name}</b>, a identidade e os acessos.</p></div></div>
    <div className="settings-layout"><nav className="settings-nav"><button className={tab === "space" ? "selected" : ""} onClick={() => setTab("space")}><BriefcaseBusiness size={17} /> Espaço</button><button className={tab === "team" ? "selected" : ""} onClick={() => setTab("team")}><UsersRound size={17} /> Equipe <span>{members.length}</span></button><button className={tab === "data" ? "selected" : ""} onClick={() => setTab("data")}><ArrowDownToLine size={17} /> Dados</button></nav>
      <div className="settings-main">
        {tab === "space" && <section className="panel settings-card"><div className="section-title"><div><h2>Identidade do espaço</h2><p>Deixe cada espaço com a cara da empresa ou equipe.</p></div><span className="workspace-icon preview-space-icon" style={{ background: form.accentColor }}>{iconFor(form.icon)}</span></div>
          <form className="settings-form" onSubmit={(event) => void saveSpace(event)}><label className="field-label">Nome da empresa / espaço<input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!isOwner} placeholder="Ex.: Agência Gama" /></label><label className="field-label">Descrição<textarea rows={3} maxLength={280} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!isOwner} placeholder="Uma breve descrição para a equipe." /></label>
            <div className="settings-choice-grid"><fieldset className="icon-choice"><legend>Ícone do espaço</legend><div>{["briefcase", "sparkles", "users", "layers", "heart", "building"].map((icon) => <button type="button" key={icon} className={form.icon === icon ? "chosen" : ""} disabled={!isOwner} onClick={() => setForm({ ...form, icon })} aria-label={`Selecionar ícone ${icon}`}>{iconFor(icon)}</button>)}</div></fieldset><fieldset className="color-choice"><legend>Cor de destaque</legend><div>{["#F65A1E", "#C94412", "#5F5B55", "#507C70", "#536B98", "#9A6C83"].map((color) => <button type="button" key={color} className={form.accentColor === color ? "chosen" : ""} style={{ "--swatch": color } as React.CSSProperties} onClick={() => setForm({ ...form, accentColor: color })} disabled={!isOwner} aria-label={`Selecionar cor ${color}`} />)}</div></fieldset></div>
            {isOwner && <div className="form-actions"><span>As mudanças aparecem para todos neste espaço.</span><button className="button button-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button></div>}{!isOwner && <p className="muted-copy">Somente a proprietária pode personalizar este espaço.</p>}
          </form>
          <div className="role-explainer"><h3>Papéis de acesso</h3><p><b>Proprietária</b> — personaliza o espaço, gera links de convite e pode transferir a propriedade.</p><p><b>Administradora</b> — gerencia usuários, convites e permissões, sem alterar ou transferir a propriedade.</p><p><b>Colaboradora</b> — trabalha com clientes, atendimentos, agenda e tarefas.</p></div>
        </section>}
        {tab === "team" && <>
          <section className="panel settings-card guest-seat-card">
            <div className="section-title"><div><h2>Vagas de convidados</h2><p>Membros e convites pendentes, sem incluir a proprietária.</p></div><span className="member-count"><UsersRound size={15} /> {guestSeats.used}/{guestSeats.included}</span></div>
            <div className="guest-seat-meter"><span style={{ width: `${Math.min(100, guestSeats.used / Math.max(1, guestSeats.included) * 100)}%` }} /></div>
            <p>{guestSeats.active} membro(s) ativo(s) · {guestSeats.pending} convite(s) aguardando resposta.</p>
            {guestSeats.additional > 0 ? <small>Convidados adicionais seguem gratuitos durante a fase de testes. {FUTURE_PRICING_NOTICE}</small> : <small>Os 3 primeiros convidados estão incluídos. {BETA_FREE_NOTICE} {FUTURE_PRICING_NOTICE}</small>}
          </section>
          <section className="panel settings-card">
            <div className="section-title"><div><h2>Membros</h2><p>Quem pode acessar o espaço <b>{workspace.name}</b>.</p></div><span className="member-count"><UsersRound size={15} /> {members.length}</span></div>
            <div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}>
              <Avatar name={member.name} small /><span className="member-copy"><b>{member.name}{member.user_id === user.id ? " (você)" : ""}</b><small>{member.email}</small></span>
              <span className={`member-role role-${member.role}`}>{member.role === "owner" ? "Proprietária" : member.role === "admin" ? "Administradora" : "Colaboradora"}</span>
              {canManageTeam && member.role !== "owner" && member.user_id !== user.id && <select value={member.role} onChange={(e) => void setMemberRole(member, e.target.value)} aria-label={`Papel de ${member.name}`}><option value="collaborator">Colaboradora</option><option value="admin">Administradora</option>{isOwner && <option value="owner">Transferir propriedade</option>}</select>}
              {canManageTeam && member.role !== "owner" && member.user_id !== user.id && <button className="icon-button remove-member" title="Remover acesso" onClick={() => void removeMember(member)}><X size={15} /></button>}
            </div>)}</div>
            {!canManageTeam && <p className="muted-copy">Proprietária e administradoras podem gerenciar convites e permissões.</p>}
          </section>
          {canManageTeam && <section className="panel settings-card invite-card">
            <div className="section-title"><div><h2>Convidar alguém</h2><p>{isOwner ? "Gere um link único ou envie o convite à conta existente." : "Convide contas já cadastradas diretamente pela caixa de convites."}</p></div><span className="invite-lock"><ShieldCheck size={16} /></span></div>
            <form className={`invite-form ${isOwner ? "invite-form-owner" : "invite-form-admin"}`} onSubmit={(e) => void createInvite(e)}>
              <label className="field-label">E-mail<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com.br" /></label>
              <label className="field-label">Papel<select value={role} onChange={(e) => setRole(e.target.value as "admin" | "collaborator")}><option value="collaborator">Colaboradora</option><option value="admin">Administradora</option></select></label>
              {isOwner && <label className="field-label">Forma de envio<select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as "account" | "link")}><option value="link">Gerar link único</option><option value="account">Enviar à conta existente</option></select></label>}
              <button className="button button-primary" disabled={busy}><Plus size={16} /> Criar convite</button>
            </form>
            {invites.length > 0 && <div className="invite-list"><p className="eyebrow">CONVITES PENDENTES</p>{invites.map((invite) => <div className="invite-row" key={invite.id}>
              <span><b>{invite.email}</b><small>{invite.role === "admin" ? "Administradora" : "Colaboradora"} · aguardando resposta até {formatDate(invite.expires_at ?? invite.expiresAt)}</small></span>
              {isOwner && <button className="text-button" onClick={() => void copyInvite(invite)}>{invite.url ? "Copiar link" : "Gerar link"}</button>}
              <button className="icon-button" onClick={() => void cancelInvite(invite)} aria-label="Cancelar convite"><X size={15} /></button>
            </div>)}</div>}
          </section>}
        </>}
        {tab === "data" && <section className="panel settings-card"><div className="section-title"><div><h2>Levar seus dados</h2><p>Exporte uma cópia sempre que precisar.</p></div><span className="data-icon"><ArrowDownToLine size={18} /></span></div><div className="export-choice"><span><b>Exportação completa</b><small>Clientes, histórico, agenda, modelos e jornadas em um arquivo JSON.</small></span><button className="button button-secondary" disabled={!canManageTeam} onClick={() => void exportData("json")}>Exportar JSON <ArrowDownToLine size={15} /></button></div><div className="export-choice"><span><b>Lista de clientes</b><small>Arquivo CSV compatível com planilhas e sistemas que aceitam CSV.</small></span><button className="button button-secondary" disabled={!canManageTeam} onClick={() => void exportData("csv")}>Exportar CSV <ArrowDownToLine size={15} /></button></div><button className="import-card" disabled={!canManageTeam} onClick={() => window.dispatchEvent(new CustomEvent("gama:import"))}><span className="import-card-icon"><FileUp size={18} /></span><span><b>Importar do Notion ou de uma planilha</b><small>Use um CSV ou exportação do Notion em ZIP. Escolha uma tabela de clientes.</small></span><ArrowRight size={16} /></button>{!canManageTeam && <p className="muted-copy">A exportação e importação ficam disponíveis para proprietária e administradoras.</p>}</section>}
      </div></div>
  </div>;
}

function SearchOverlay({ workspace, onClose, onOpenClient }: { workspace: Workspace; onClose: () => void; onOpenClient: (client: Client) => void }) {
  const [query, setQuery] = useState(""); const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => { void api<{ clients: Client[] }>(`workspaces/${workspace.id}/clients`).then((response) => setClients(response.clients)); }, [workspace.id]);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, [onClose]);
  const results = clients.filter((client) => `${client.name} ${client.email ?? ""} ${client.product}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  return <div className="overlay search-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="search-dialog"><div className="search-dialog-input"><Search size={19} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar clientes neste espaço…" /><kbd>ESC</kbd></div>{query ? results.length ? <div className="search-results">{results.map((client) => <button key={client.id} onClick={() => onOpenClient(client)}><Avatar name={client.name} small /><span><b>{client.name}</b><small>{client.email || client.product || "Cliente"}</small></span><ArrowRight size={15} /></button>)}</div> : <p className="search-empty">Nenhum cliente encontrado.</p> : <p className="search-empty"><Command size={15} /> Digite para buscar em {workspace.name}.</p>}</div></div>;
}

function WorkspaceModal({ onClose, onSave, saving = false }: { onClose: () => void; onSave: (data: Record<string, unknown>) => void; saving?: boolean }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [icon, setIcon] = useState("briefcase"); const [accentColor, setAccentColor] = useState("#F65A1E"); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()) { setError("Informe um nome para o espaço."); return; } try { await onSave({ name, description, icon, accentColor }); } catch (e) { setError(errorText(e)); } }
  return <Modal title="Criar espaço" eyebrow="NOVO ESPAÇO DE EMPRESA" onClose={onClose}><p className="modal-intro">Cada espaço mantém clientes, agenda e equipe separados. Você poderá personalizar tudo depois.</p><p className="beta-modal-note">{BETA_FREE_NOTICE} Limite de {BETA_SPACE_LIMIT} espaços próprios por conta. {FUTURE_PRICING_NOTICE}</p><form className="modal-form" onSubmit={(e) => void submit(e)}><label className="field-label">Nome da empresa ou espaço<input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Agência Gama" /></label><label className="field-label">Descrição <span className="optional">opcional</span><textarea maxLength={280} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Uma linha para ajudar a identificar este espaço." /></label><div className="settings-choice-grid"><fieldset className="icon-choice"><legend>Ícone</legend><div>{["briefcase", "sparkles", "users", "layers", "heart", "building"].map((choice) => <button type="button" key={choice} className={icon === choice ? "chosen" : ""} onClick={() => setIcon(choice)} aria-label={choice}>{iconFor(choice)}</button>)}</div></fieldset><fieldset className="color-choice"><legend>Cor</legend><div>{["#F65A1E", "#C94412", "#5F5B55", "#507C70", "#536B98", "#9A6C83"].map((color) => <button type="button" key={color} className={accentColor === color ? "chosen" : ""} style={{ "--swatch": color } as React.CSSProperties} onClick={() => setAccentColor(color)} aria-label={color} />)}</div></fieldset></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? "Criando…" : "Criar espaço"}<ArrowRight size={16} /></button></div></form></Modal>;
}

function BootstrapAdminInviteModal({ invites, onClose }: { invites: BootstrapAdminInvite[]; onClose: () => void }) {
  const [copied, setCopied] = useState("");
  async function copyInvite(invite: BootstrapAdminInvite) {
    await navigator.clipboard.writeText(invite.url);
    setCopied(invite.email);
  }
  return <Modal title="Convide a equipe de administração" eyebrow="CONFIGURAÇÃO INICIAL" onClose={onClose}>
    <p className="modal-intro">O espaço da Agência Gama já está pronto. Compartilhe este convite com cada administradora para liberar o acesso.</p>
    <div className="bootstrap-invite-list">{invites.map((invite) => <div className="bootstrap-invite-card" key={invite.email}>
      <div><b>{invite.email}</b><small>Administradora · válido por 7 dias</small></div>
      <input aria-label={`Link de convite para ${invite.email}`} readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} />
      <button className="button button-secondary" onClick={() => void copyInvite(invite)}><Check size={15} />{copied === invite.email ? "Link copiado" : "Copiar convite"}</button>
    </div>)}</div>
    <div className="modal-actions"><button className="button button-primary" onClick={onClose}>Concluir <ArrowRight size={15} /></button></div>
  </Modal>;
}

function ClientModal({ workspace, data, onClose, onSaved }: { workspace: Workspace; data?: Client; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: data?.name || "", email: data?.email || "", phone: data?.phone || "", product: data?.product || "", status: (data?.status || "active") as Client["status"], isFidelized: Boolean(data?.is_fidelized), nextFollowupAt: toDateTimeLocal(data?.next_followup_at), notes: data?.notes || "" }); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setError(""); try { const body = { ...form, nextFollowupAt: form.nextFollowupAt ? new Date(form.nextFollowupAt).toISOString() : null }; if (data) await api(`workspaces/${workspace.id}/clients/${data.id}`, patchJson(body)); else await api(`workspaces/${workspace.id}/clients`, json(body)); onSaved(); } catch (err) { setError(errorText(err)); } }
  return <Modal title={data ? "Editar cliente" : "Novo cliente"} eyebrow="CARTEIRA DE CLIENTES" onClose={onClose} wide><form className="modal-form" onSubmit={(e) => void submit(e)}><div className="form-grid"><label className="field-label span-two">Nome<input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome da pessoa ou empresa" /></label><label className="field-label">E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@empresa.com" /></label><label className="field-label">Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" /></label><label className="field-label">Produto ou serviço<input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="Ex.: Mentoria" /></label><label className="field-label">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Client["status"] })}><option value="active">Ativo</option><option value="paused">Pausado</option><option value="discontinued">Encerrado</option></select></label><label className="field-label span-two">Próximo retorno<input type="datetime-local" value={form.nextFollowupAt} onChange={(e) => setForm({ ...form, nextFollowupAt: e.target.value })} /></label><label className="field-label span-two">Anotações<textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Contexto importante para a equipe." /></label><label className="checkbox-label span-two"><input type="checkbox" checked={form.isFidelized} onChange={(e) => setForm({ ...form, isFidelized: e.target.checked })} /><span>Marcar como cliente fidelizado</span></label></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">{data ? "Salvar alterações" : "Adicionar cliente"}</button></div></form></Modal>;
}

function InteractionModal({ workspace, client, onClose, onEdit, onSaved }: { workspace: Workspace; client: Client; onClose: () => void; onEdit: () => void; onSaved: () => void }) {
  const [details, setDetails] = useState<{ client: Client; interactions: Interaction[]; journeys: Array<{ id: string; template_name: string; stages_json: string; status: string }> } | null>(null); const [templates, setTemplates] = useState<JourneyTemplate[]>([]); const [summary, setSummary] = useState(""); const [channel, setChannel] = useState("whatsapp"); const [nextAction, setNextAction] = useState(""); const [nextFollowupAt, setNextFollowupAt] = useState(""); const [journeyTemplate, setJourneyTemplate] = useState(""); const [error, setError] = useState("");
  const refresh = useCallback(async () => { const [d, t] = await Promise.all([api<{ client: Client; interactions: Interaction[]; journeys: Array<{ id: string; template_name: string; stages_json: string; status: string }> }>(`workspaces/${workspace.id}/clients/${client.id}`), api<{ templates: JourneyTemplate[] }>(`workspaces/${workspace.id}/templates`)]); setDetails(d); setTemplates(t.templates.filter((template) => template.is_active)); }, [workspace.id, client.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function addInteraction(e: FormEvent) { e.preventDefault(); try { await api(`workspaces/${workspace.id}/clients/${client.id}/interactions`, json({ summary, channel, nextAction, nextFollowupAt: nextFollowupAt ? new Date(nextFollowupAt).toISOString() : null })); onSaved(); } catch (issue) { setError(errorText(issue)); } }
  async function attachJourney(e: FormEvent) { e.preventDefault(); if (!journeyTemplate) return; try { await api(`workspaces/${workspace.id}/clients/${client.id}/journeys`, json({ templateId: journeyTemplate })); setJourneyTemplate(""); await refresh(); } catch (issue) { setError(errorText(issue)); } }
  const actual = details?.client ?? client;
  return <Modal title={actual.name} eyebrow="FICHA DO CLIENTE" onClose={onClose} wide><div className="client-profile-head"><Avatar name={actual.name} /><div><b>{actual.name}</b><small>{actual.email || actual.phone || "Contato não cadastrado"}</small></div><StatusBadge status={actual.status} />{actual.is_fidelized ? <em className="fidelized-tag"><Tag size={11} /> Fidelizado</em> : null}<button className="button button-secondary edit-client-button" onClick={onEdit}><Settings2 size={14} /> Editar ficha</button></div>
    <div className="client-profile-grid"><div className="profile-detail"><small>PRODUTO / SERVIÇO</small><b>{actual.product || "—"}</b></div><div className="profile-detail"><small>PRÓXIMO RETORNO</small><b>{formatDate(actual.next_followup_at, { day: "2-digit", month: "long", year: "numeric" })}</b></div><div className="profile-notes"><small>ANOTAÇÕES</small><p>{actual.notes || "Sem anotações"}</p></div></div>
    <div className="modal-inner-split"><section className="interaction-history"><div className="inline-section-heading"><h3>Histórico de atendimentos</h3><span>{details?.interactions.length ?? 0}</span></div>{details?.interactions.length ? <div className="history-list">{details.interactions.map((item) => <article className="history-item" key={item.id}><span className="history-marker" /><div><small>{formatDate(item.happened_at, { day: "2-digit", month: "short", year: "numeric" })} · {item.actor_name} · {channelLabel(item.channel)}</small><p>{item.summary}</p>{item.next_action && <em>Próximo passo: {item.next_action}</em>}</div></article>)}</div> : <p className="muted-copy">Ainda não há atendimentos registrados.</p>}
      {details?.journeys.length ? <div className="journey-box"><div className="inline-section-heading"><h3>Jornadas em andamento</h3></div>{details.journeys.map((journey) => <div className="journey-row" key={journey.id}><span><FolderKanban size={15} />{journey.template_name}</span><span className="journey-stages">{parseStages(journey.stages_json).map((stage, i) => <em key={i}>{String(stage)}</em>)}</span></div>)}</div> : <form className="attach-journey" onSubmit={(e) => void attachJourney(e)}><label className="field-label">Iniciar uma jornada<select value={journeyTemplate} onChange={(e) => setJourneyTemplate(e.target.value)}><option value="">Escolha um modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button className="button button-secondary" disabled={!journeyTemplate}>Aplicar modelo</button></form>}
    </section><form className="interaction-form" onSubmit={(e) => void addInteraction(e)}><h3>Registrar atendimento</h3><label className="field-label">Canal<select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="call">Ligação</option><option value="meeting">Reunião</option><option value="other">Outro</option></select></label><label className="field-label">Resumo<textarea required rows={4} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="O que foi conversado?" /></label><label className="field-label">Próxima ação<input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: enviar proposta" /></label><label className="field-label">Data do retorno<input type="datetime-local" value={nextFollowupAt} onChange={(e) => setNextFollowupAt(e.target.value)} /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => onSaved()}>Fechar</button><button className="button button-primary">Registrar</button></div></form></div>
  </Modal>;
}
function channelLabel(channel: string) { return ({ whatsapp: "WhatsApp", email: "E-mail", call: "Ligação", meeting: "Reunião", other: "Outro" } as Record<string, string>)[channel] || channel; }

function TaskModal({ workspace, data, onClose, onSaved }: { workspace: Workspace; data?: Partial<Task> & { date?: Date }; onClose: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[]>([]); const [form, setForm] = useState({ title: data?.title || "", details: data?.details || "", kind: (data?.kind || "task") as Task["kind"], status: (data?.status || "open") as Task["status"], dueAt: toDateTimeLocal(data?.due_at ?? data?.date?.getTime()), startAt: toDateTimeLocal(data?.start_at ?? data?.due_at ?? data?.date?.getTime()), endAt: toDateTimeLocal(data?.end_at), clientId: data?.client_id || "", isShared: data?.is_shared !== 0 }); const [error, setError] = useState("");
  useEffect(() => { void api<{ clients: Client[] }>(`workspaces/${workspace.id}/clients`).then((response) => setClients(response.clients)); }, [workspace.id]);
  async function submit(e: FormEvent) { e.preventDefault(); const dateVal = (value: string) => value ? new Date(value).toISOString() : null; try { const body = { ...form, clientId: form.clientId || null, dueAt: dateVal(form.dueAt), startAt: dateVal(form.startAt), endAt: dateVal(form.endAt) }; if (data?.id) await api(`workspaces/${workspace.id}/tasks/${data.id}`, patchJson(body)); else await api(`workspaces/${workspace.id}/tasks`, json(body)); onSaved(); } catch (issue) { setError(errorText(issue)); } }
  return <Modal title={data?.id ? "Editar item" : form.kind === "appointment" ? "Novo compromisso" : "Nova tarefa"} eyebrow="AGENDA DO ESPAÇO" onClose={onClose}><form className="modal-form" onSubmit={(e) => void submit(e)}><label className="field-label">Título<input required autoFocus maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.kind === "appointment" ? "Ex.: Reunião de alinhamento" : "Ex.: Preparar proposta"} /></label><div className="form-grid"><label className="field-label">Tipo<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Task["kind"] })}><option value="task">Tarefa</option><option value="appointment">Compromisso</option></select></label><label className="field-label">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Task["status"] })}><option value="open">Em aberto</option><option value="in_progress">Em andamento</option><option value="done">Concluída</option></select></label><label className="field-label">Data e horário<input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value, dueAt: e.target.value })} /></label><label className="field-label">Até <span className="optional">opcional</span><input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label><label className="field-label span-two">Cliente relacionado<select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Sem cliente vinculado</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field-label span-two">Detalhes<textarea rows={3} maxLength={2000} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Contexto e informações para realizar este item." /></label></div><label className="checkbox-label"><input type="checkbox" checked={form.isShared} onChange={(e) => setForm({ ...form, isShared: e.target.checked })} /><span>Compartilhar com a equipe</span></label><p className="modal-hint">{form.isShared ? "Todos no espaço poderão ver este item." : "Este item aparecerá somente para você."}</p>{error && <div className="form-error">{error}</div>}<div className="modal-actions">{data?.id && <button type="button" className="button button-quiet-danger" onClick={async () => { if (window.confirm("Excluir este item?")) { await api(`workspaces/${workspace.id}/tasks/${data.id}`, { method: "DELETE" }); onSaved(); } }}>Excluir</button>}<span className="modal-spacer" /><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">Salvar</button></div></form></Modal>;
}

function TemplateModal({ workspace, data, onClose, onSaved }: { workspace: Workspace; data?: JourneyTemplate; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(data?.name || ""); const [category, setCategory] = useState(data?.category || "Geral"); const [description, setDescription] = useState(data?.description || ""); const [stages, setStages] = useState(parseStages(data?.stages_json || "[]").map(String)); const [error, setError] = useState("");
  async function save(e: FormEvent) { e.preventDefault(); const clean = stages.map((stage) => stage.trim()).filter(Boolean); if (!clean.length) { setError("Adicione ao menos uma etapa."); return; } try { const body = { name, category, description, stages: clean, isActive: data?.is_active !== 0 }; if (data) await api(`workspaces/${workspace.id}/templates/${data.id}`, patchJson(body)); else await api(`workspaces/${workspace.id}/templates`, json(body)); onSaved(); } catch (issue) { setError(errorText(issue)); } }
  return <Modal title={data ? "Editar modelo" : "Criar modelo"} eyebrow="MODELO REUTILIZÁVEL" onClose={onClose}><form className="modal-form" onSubmit={(e) => void save(e)}><label className="field-label">Nome<input autoFocus required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Jornada de boas-vindas" /></label><label className="field-label">Categoria<input maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Geral, Mentoria…" /></label><label className="field-label">Descrição<textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que este modelo serve?" /></label><div className="field-label"><span>Etapas <span className="optional">uma por linha</span></span><textarea rows={6} value={stages.join("\n")} onChange={(e) => setStages(e.target.value.split("\n"))} placeholder={"Boas-vindas\nDiagnóstico\nPlano de ação\nAcompanhamento"} /></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">{data ? "Salvar modelo" : "Criar modelo"}</button></div></form></Modal>;
}

function ImportModal({ workspace, onClose, onImported }: { workspace: Workspace; onClose: () => void; onImported: (count: number) => void }) {
  const [file, setFile] = useState<File | null>(null); const [rows, setRows] = useState<Array<Record<string, unknown>>>([]); const [columns, setColumns] = useState<string[]>([]); const [mapping, setMapping] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [zipEntries, setZipEntries] = useState<Array<{ name: string; content: string }> | null>(null); const [selectedCsv, setSelectedCsv] = useState("");
  async function readFile(next: File | null) { if (!next) return; setFile(next); setError(""); try { if (next.name.toLowerCase().endsWith(".zip")) { const zip = await JSZip.loadAsync(next); const csvs = await Promise.all(Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv")).slice(0, 30).map(async (entry) => ({ name: entry.name, content: await entry.async("text") }))); if (!csvs.length) throw new Error("Não encontrei arquivos CSV dentro desta exportação."); setZipEntries(csvs); setSelectedCsv(csvs[0].name); parseCsv(csvs[0].content); } else { setZipEntries(null); parseCsv(await next.text()); } } catch (issue) { setError(errorText(issue)); } }
  function parseCsv(csv: string) { const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true, dynamicTyping: false }); if (parsed.errors.length && !parsed.data.length) throw new Error("Não consegui ler este CSV."); const headers = parsed.meta.fields || []; if (!headers.length) throw new Error("O arquivo não tem cabeçalhos de coluna."); setColumns(headers); setRows(parsed.data.slice(0, 500)); const guess = (pattern: RegExp) => headers.find((header) => pattern.test(header)); setMapping({ name: guess(/name|nome|client|cliente|title/i) || "", email: guess(/email|e-mail/i) || "", phone: guess(/phone|telefone|celular|whats/i) || "", product: guess(/product|produto|service|serviço|plano/i) || "", status: guess(/status|situação|situacao/i) || "", notes: guess(/notes|notas|anotações|observa/i) || "" }); }
  async function changeZipCsv(name: string) { setSelectedCsv(name); const entry = zipEntries?.find((item) => item.name === name); if (entry) parseCsv(entry.content); }
  async function importRows() { setBusy(true); setError(""); try { const records = rows.map((row) => ({ name: String(row[mapping.name] ?? "").trim(), email: mapping.email ? row[mapping.email] : "", phone: mapping.phone ? row[mapping.phone] : "", product: mapping.product ? row[mapping.product] : "", status: normalizeStatus(mapping.status ? row[mapping.status] : ""), isFidelized: /fidel|loyal/i.test(String(row.fidelizado ?? row.fidelized ?? "")), notes: mapping.notes ? row[mapping.notes] : "" })).filter((row) => row.name); const response = await api<{ imported: number }>(`workspaces/${workspace.id}/clients/import`, json({ records })); onImported(response.imported); } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); } }
  const validCount = rows.filter((row) => String(row[mapping.name] ?? "").trim()).length;
  return <Modal title="Importar clientes" eyebrow="IMPORTAÇÃO DE DADOS" onClose={onClose} wide><p className="modal-intro">Use um CSV ou a exportação do Notion em ZIP. Os dados são enviados para <b>{workspace.name}</b> e até 500 clientes são importados por vez.</p>{!rows.length ? <label className="upload-drop"><input type="file" accept=".csv,.zip,text/csv,application/zip" onChange={(e) => void readFile(e.target.files?.[0] ?? null)} /><span className="upload-icon"><FileUp size={22} /></span><b>Escolha um arquivo CSV ou ZIP</b><small>O CSV precisa ter uma linha de cabeçalho. Você seleciona as colunas antes de importar.</small></label> : <><div className="import-file-info"><span className="upload-icon"><FileUp size={18} /></span><span><b>{file?.name}</b><small>{rows.length} linhas encontradas</small></span><button className="text-button" onClick={() => { setRows([]); setColumns([]); setFile(null); setZipEntries(null); }}>Trocar arquivo</button></div>{zipEntries && <label className="field-label">Tabela do Notion<select value={selectedCsv} onChange={(e) => void changeZipCsv(e.target.value)}>{zipEntries.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>}<div className="mapping-grid">{[["name", "Nome do cliente*"], ["email", "E-mail"], ["phone", "Telefone"], ["product", "Produto / serviço"], ["status", "Status"], ["notes", "Anotações"]].map(([key, label]) => <label className="field-label" key={key}>{label}<select value={mapping[key]} required={key === "name"} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}><option value="">Não importar</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}</div><div className="import-preview"><p className="eyebrow">PRÉVIA · {validCount} CLIENTES VÁLIDOS</p><div className="preview-table"><div><b>Nome</b><b>E-mail</b><b>Produto / serviço</b></div>{rows.slice(0, 3).map((row, i) => <div key={i}><span>{String(row[mapping.name] || "—")}</span><span>{String(row[mapping.email] || "—")}</span><span>{String(row[mapping.product] || "—")}</span></div>)}</div></div></>}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={!validCount || busy} onClick={() => void importRows()}>{busy ? "Importando…" : `Importar ${validCount} clientes`}<ArrowRight size={15} /></button></div></Modal>;
}
function normalizeStatus(value: unknown) { const status = String(value).toLowerCase(); if (/pause|paused|inativ/.test(status)) return "paused"; if (/encerr|discontinu|closed/.test(status)) return "discontinued"; return "active"; }

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) { useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]); return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div><div className="modal-body">{children}</div></section></div>; }

function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{detail}</p>{action && <div className="empty-action">{action}</div>}</div>; }
function LoadingRows() { return <div className="loading-rows"><span /><span /><span /></div>; }
function Avatar({ name, small = false }: { name: string; small?: boolean }) { const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR"); return <span className={`avatar ${small ? "avatar-small" : ""}`} aria-hidden="true">{initials}</span>; }
function iconFor(value: string) { const props = { size: 18, strokeWidth: 1.9 }; if (value === "sparkles") return <Sparkles {...props} />; if (value === "users") return <UsersRound {...props} />; if (value === "layers") return <FolderKanban {...props} />; if (value === "heart") return <Activity {...props} />; if (value === "building") return <BriefcaseBusiness {...props} />; return <BriefcaseBusiness {...props} />; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "Não foi possível concluir esta ação."; }

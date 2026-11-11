import {
  ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCheck,
  Clock3, Layers3, UsersRound,
} from "lucide-react";
import { BrandMark } from "./BrandMark";
import "./LandingPage.css";

const features = [
  {
    icon: UsersRound,
    label: "RELACIONAMENTO",
    title: "Clientes com contexto.",
    text: "Reúna contatos, informações importantes, próximos retornos e o histórico de cada atendimento.",
  },
  {
    icon: CalendarDays,
    label: "ROTINA",
    title: "Agenda que acompanha a equipe.",
    text: "Visualize compromissos e tarefas compartilhadas sem perder de vista o que é pessoal.",
  },
  {
    icon: Layers3,
    label: "ESPAÇOS",
    title: "Cada empresa, do seu jeito.",
    text: "Crie espaços independentes, personalize a identidade e convide as pessoas certas.",
  },
];

export function LandingPage() {
  return <main className="landing-page" id="top">
    <header className="landing-nav">
      <a href="#top" className="landing-brand" aria-label="Gama Work, início"><BrandMark /><span>GAMA <b>WORK</b></span></a>
      <span className="landing-nav-note">Organização que acompanha o seu trabalho.</span>
      <a className="landing-nav-cta" href="/?cadastro=1">Criar conta gratuita <ArrowRight size={15} /></a>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow"><span /> FERRAMENTA DE TRABALHO PARA EQUIPES</p>
        <h1>Ideias em movimento.<br /><em>Trabalho em sintonia.</em></h1>
        <p className="landing-lead">Um espaço claro para cuidar dos clientes, registrar conversas e acompanhar os próximos passos da equipe.</p>
        <div className="landing-hero-actions"><a className="landing-primary-button" href="/?cadastro=1">Criar conta gratuita <ArrowRight size={17} /></a><a className="landing-text-link" href="#recursos">Conhecer os recursos <ArrowDown size={15} /></a></div>
        <p className="landing-access-note"><Check size={14} /> Acesso gratuito. Crie seu espaço e convide sua equipe.</p>
      </div>

      <div className="landing-preview-wrap" aria-label="Prévia do painel Gama Work">
        <div className="preview-orbit preview-orbit-one" /><div className="preview-orbit preview-orbit-two" />
        <div className="preview-window">
          <div className="preview-topbar"><div className="preview-dots"><i /><i /><i /></div><span>GAMA <b>WORK</b></span><span className="preview-user">G</span></div>
          <div className="preview-layout">
            <aside className="preview-sidebar"><div className="preview-space"><span className="preview-space-icon">G</span><span><b>Agência Gama</b><small>Espaço da empresa</small></span></div><div className="preview-nav-item preview-nav-active"><span>▦</span> Visão geral</div><div className="preview-nav-item"><UsersRound size={14} /> Clientes</div><div className="preview-nav-item"><CalendarDays size={14} /> Agenda</div><div className="preview-nav-item"><CheckCheck size={14} /> Tarefas</div></aside>
            <div className="preview-content"><div className="preview-heading"><span><small>PAINEL DA EQUIPE</small><b>Bom trabalho, Gabi.</b></span><span className="preview-add">+</span></div>
              <div className="preview-stats"><div><small>CLIENTES</small><b>24</b><span>neste espaço</span></div><div><small>RETORNOS</small><b>06</b><span>para acompanhar</span></div><div><small>TAREFAS</small><b>12</b><span>em andamento</span></div></div>
              <div className="preview-lists"><div className="preview-panel"><div className="preview-panel-title"><span>Próximos retornos</span><small>VER TODOS →</small></div><div className="preview-client"><span className="preview-avatar">ML</span><span><b>Marina Lopes</b><small>Identidade visual</small></span><span className="preview-date">HOJE</span></div><div className="preview-client"><span className="preview-avatar avatar-warm">RC</span><span><b>Rafael Costa</b><small>Estratégia de marca</small></span><span className="preview-date">AMANHÃ</span></div></div>
                <div className="preview-panel preview-agenda"><div className="preview-panel-title"><span>Na agenda</span><Clock3 size={13} /></div><div className="preview-event"><span /><span><b>Reunião de alinhamento</b><small>10:30 · Marina Lopes</small></span></div><div className="preview-event event-orange"><span /><span><b>Revisar proposta</b><small>14:00 · Equipe</small></span></div></div></div>
            </div>
          </div>
        </div>
        <div className="preview-float preview-float-task"><span><CheckCheck size={15} /></span><span><b>Tarefa concluída</b><small>Briefing organizado</small></span><Check size={15} /></div>
        <div className="preview-float preview-float-space"><span className="float-space-icon"><Layers3 size={15} /></span><span><b>Seus espaços</b><small>Um lugar para cada equipe</small></span></div>
      </div>
    </section>

    <section className="landing-features" id="recursos">
      <div className="landing-section-heading"><p className="landing-eyebrow">MENOS DISPERSÃO, MAIS CLAREZA</p><h2>O essencial para o trabalho<br />andar bem.</h2><p>Uma base simples para a equipe organizar o agora e construir os próximos passos.</p></div>
      <div className="landing-feature-grid">{features.map(({ icon: Icon, label, title, text }, index) => <article className="landing-feature-card" key={label}><span className="feature-icon"><Icon size={19} strokeWidth={1.8} /></span><p className="landing-eyebrow">{label} <span>0{index + 1}</span></p><h3>{title}</h3><p>{text}</p><a href="/" aria-label={`Acessar Gama Work: ${title}`}><ArrowRight size={16} /></a></article>)}</div>
    </section>

    <section className="landing-cta">
      <div className="landing-cta-symbol"><BrandMark /></div>
      <div><p className="landing-eyebrow">AGÊNCIA GAMA</p><h2>Um espaço organizado.<br />No ritmo da sua equipe.</h2></div>
      <a href="/?cadastro=1" className="landing-primary-button">Criar conta gratuita <ArrowRight size={17} /></a>
    </section>

    <footer className="landing-footer">
      <div className="footer-main">
        <a href="#top" className="footer-brand" aria-label="Gama Work, início"><BrandMark /><span>Gama<span>Work</span></span></a>
        <p className="footer-tagline">Produtos digitais da Agência Gama<br />para organizar ideias e avançar com clareza.</p>
        <div className="footer-contact"><p className="footer-label">CONTATO</p><a href="https://wa.me/5514998024492" target="_blank" rel="noreferrer">WhatsApp · (14) 99802-4492 <span>↗</span></a><span>Avaré/SP · atendimento online</span><a href="https://agenciagama.com.br" target="_blank" rel="noreferrer">Conheça a Agência Gama <span>↗</span></a></div>
        <div className="footer-contact footer-secondary"><a href="mailto:contato@agenciagama.com.br">contato@agenciagama.com.br</a><a href="https://www.instagram.com/agenciagama/" target="_blank" rel="noreferrer">Instagram da Agência Gama <span>↗</span></a></div>
      </div>
      <div className="footer-bottom"><span>© 2026 GAMA COMUNICAÇÃO</span><span>ESTRATÉGIA · DESIGN · TECNOLOGIA</span><a href="#top">VOLTAR AO TOPO <ArrowUp size={11} /></a></div>
    </footer>
  </main>;
}

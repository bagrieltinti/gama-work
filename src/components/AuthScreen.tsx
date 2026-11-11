import { useState, type FormEvent } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Sparkles } from "lucide-react";
import { authClient } from "../lib/auth-client";

interface AuthScreenProps {
  googleEnabled: boolean;
  invitation?: { workspace_name: string; email: string; role: string } | null;
  onAuthenticated: () => void | Promise<void>;
}

export function AuthScreen({ googleEnabled, invitation, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">(invitation ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({ name: name.trim(), email: email.trim().toLowerCase(), password });
        if (result.error) throw new Error(result.error.message || "Não foi possível criar sua conta.");
      } else {
        const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
        if (result.error) throw new Error(result.error.message || "E-mail ou senha incorretos.");
      }
      await onAuthenticated();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Não foi possível entrar agora.");
    } finally {
      setBusy(false);
    }
  }

  async function signInGoogle() {
    setError("");
    setBusy(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: window.location.href });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Não foi possível entrar com o Google.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="auth-brand"><span className="brand-mark">G</span><span>GAMA <b>WORK</b></span></div>
        <div className="auth-story-copy">
          <p className="eyebrow">UM ESPAÇO PARA TRABALHAR EM EQUIPE</p>
          <h1>O trabalho<br />em um só lugar.</h1>
          <p className="auth-lead">Clientes, conversas, compromissos e próximos passos com a clareza que o seu time precisa.</p>
          <div className="auth-feature-list">
            <span><Check size={16} /> Espaços separados por empresa</span>
            <span><Check size={16} /> Agenda compartilhada e pessoal</span>
            <span><Check size={16} /> Histórico simples de acompanhar</span>
          </div>
        </div>
        <div className="auth-story-note"><Sparkles size={15} /> Feito para a rotina das equipes Gama.</div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand"><span className="brand-mark">G</span><span>GAMA <b>WORK</b></span></div>
          {invitation && (
            <div className="invite-banner">
              <BriefcaseBusiness size={18} />
              <span>Você foi convidada para <strong>{invitation.workspace_name}</strong>.</span>
            </div>
          )}
          <p className="eyebrow">ACESSO AO ESPAÇO</p>
          <h2>{mode === "login" ? "Acesse seu espaço" : "Crie sua conta"}</h2>
          <p className="auth-subtitle">
            {invitation
              ? "Use o e-mail do convite para entrar na equipe."
              : mode === "login"
                ? "Entre para continuar de onde sua equipe parou."
                : "O acesso aos espaços é liberado por convite da proprietária."}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label className="field-label">Seu nome
                <input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Como a equipe chama você?" />
              </label>
            )}
            <label className="field-label">E-mail
              <input autoComplete="email" type="email" required value={email} readOnly={Boolean(invitation)} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />
            </label>
            <label className="field-label">Senha
              <input autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Pelo menos 10 caracteres" />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button button-primary button-full" type="submit" disabled={busy}>
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-divider"><span>ou</span></div>
          <button className="button button-secondary button-full google-button" onClick={signInGoogle} disabled={!googleEnabled || busy} title={!googleEnabled ? "O acesso com Google será ativado após cadastrar as credenciais OAuth no Cloudflare." : undefined}>
            <GoogleMark />
            {googleEnabled ? "Continuar com Google" : "Google — aguardando configuração"}
          </button>
          {!googleEnabled && <p className="provider-note">O acesso com Google já está preparado. Falta cadastrar as credenciais OAuth da Agência Gama.</p>}

          <p className="auth-switch">
            {mode === "login" ? "Ainda não tem conta?" : "Já tem uma conta?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>;
}

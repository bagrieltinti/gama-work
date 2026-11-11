import { useState, type FormEvent } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, Sparkles } from "lucide-react";
import { authClient } from "../lib/auth-client";
import { isFullName, normalizeFullName } from "../lib/validation";
import { BrandMark } from "./BrandMark";

interface AuthScreenProps {
  googleEnabled: boolean;
  invitation?: { workspace_name: string; email: string; role: string } | null;
  onAuthenticated: () => void | Promise<void>;
}

export function AuthScreen({ googleEnabled, invitation, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">(invitation || new URLSearchParams(window.location.search).get("cadastro") === "1" ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        if (!isFullName(name)) throw new Error("Informe seu nome e sobrenome para criar a conta.");
        if (password !== confirmPassword) throw new Error("As senhas não coincidem.");
        if (!isStrongPassword(password)) throw new Error("Sua senha precisa atender a todos os critérios de segurança.");
        const result = await authClient.signUp.email({ name: normalizeFullName(name), email: email.trim().toLowerCase(), password });
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
        <div className="auth-brand"><BrandMark /><span>GAMA <b>WORK</b></span></div>
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
          <div className="auth-mobile-brand"><BrandMark /><span>GAMA <b>WORK</b></span></div>
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
              ? "Use o e-mail do convite. Depois de entrar, você poderá aceitar ou recusar o acesso."
              : mode === "login"
                ? "Entre para continuar de onde sua equipe parou."
                : "Gratuito: crie seu espaço e convide sua equipe ou entre em outra empresa por convite."}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label className="field-label">Nome completo
                <input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" />
                <small className="name-note">Informe seu nome e sobrenome.</small>
              </label>
            )}
            <label className="field-label">E-mail
              <input autoComplete="email" type="email" required value={email} readOnly={Boolean(invitation)} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />
            </label>
            <label className="field-label">Senha
              <span className="password-field"><input autoComplete={mode === "login" ? "current-password" : "new-password"} type={showPassword ? "text" : "password"} minLength={mode === "register" ? 12 : 10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "Crie uma senha forte" : "Sua senha"} /><button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Exibir senha"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>
            {mode === "register" && <>
              <div className="password-strength" aria-live="polite">
                <div className="strength-heading"><span>Força da senha</span><b className={`strength-label strength-${passwordStrength(password).level}`}>{passwordStrength(password).label}</b></div>
                <div className="strength-track" role="meter" aria-label="Força da senha" aria-valuemin={0} aria-valuemax={5} aria-valuenow={passwordStrength(password).score}><span className={`strength-fill strength-fill-${passwordStrength(password).level}`} style={{ width: `${passwordStrength(password).score * 20}%` }} /></div>
                <ul className="password-rules">
                  <PasswordRule met={password.length >= 12} label="12 caracteres" />
                  <PasswordRule met={/[a-z]/.test(password)} label="Letra minúscula" />
                  <PasswordRule met={/[A-Z]/.test(password)} label="Letra maiúscula" />
                  <PasswordRule met={/\d/.test(password)} label="Número" />
                  <PasswordRule met={/[^A-Za-z0-9]/.test(password)} label="Símbolo" />
                </ul>
              </div>
              <label className="field-label">Confirme sua senha
                <span className="password-field"><input autoComplete="new-password" type={showConfirmPassword ? "text" : "password"} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Digite a senha novamente" aria-invalid={Boolean(confirmPassword && confirmPassword !== password)} /><button className="password-toggle" type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Ocultar confirmação de senha" : "Exibir confirmação de senha"} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
                {confirmPassword && <small className={`confirm-hint ${confirmPassword === password ? "confirm-match" : "confirm-mismatch"}`}>{confirmPassword === password ? "As senhas coincidem." : "As senhas ainda não coincidem."}</small>}
              </label>
            </>}
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

function passwordStrength(password: string) {
  const score = [password.length >= 12, /[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  const level = score >= 5 ? "strong" : score >= 3 ? "medium" : score > 0 ? "weak" : "empty";
  const label = level === "strong" ? "Forte" : level === "medium" ? "Média" : level === "weak" ? "Fraca" : "Digite uma senha";
  return { score, level, label };
}

function isStrongPassword(password: string) {
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return <li className={met ? "password-rule-met" : ""}><Check size={12} aria-hidden="true" />{label}</li>;
}

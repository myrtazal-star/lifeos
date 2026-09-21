/* Карточка входа и синхронизации. Общая для обоих приложений. */

import { el, field, input, toast, confirmSheet } from './ui.js';
import * as cloud from './cloud.js';

const STATUS_KEY = {
  idle: 'sync_idle', syncing: 'sync_running', ok: 'sync_ok',
  error: 'sync_error', offline: 'sync_offline',
};

/** Понятный текст вместо кода ошибки. */
export function cloudMessage(t, e) {
  const map = {
    'email-taken': 'cl_email_taken',
    'bad-email': 'cl_bad_email',
    'bad-login': 'cl_bad_login',
    'unconfirmed': 'cl_unconfirmed',
    'weak-password': 'cl_weak_password',
    'too-often': 'cl_too_often',
    'network': 'cl_network',
    'server': 'cl_server',
    'signed-out': 'cl_signed_out',
    'unauthorised': 'cl_signed_out',
  };
  const key = map[e?.code];
  return key ? t(key) : t('cl_failed') + (e?.message ? ': ' + String(e.message).slice(0, 100) : '');
}

export function cloudCard({ t, runner, rerender }) {
  const user = cloud.currentUser();
  return user ? signedInCard(t, user, runner, rerender) : signInCard(t, rerender);
}

/* ─────────── Вход не выполнен ─────────── */

function signInCard(t, rerender) {
  const email = input({ type: 'email', placeholder: 'correo@ejemplo.com',
    autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' });
  const pass = input({ type: 'password', placeholder: '••••••••',
    autocomplete: 'current-password' });
  const note = el('div.tiny', { style: { marginTop: '10px', lineHeight: '1.5' } });

  function busy(on, btns) { btns.forEach(b => { b.disabled = on; }); }

  const enter = el('button.btn.btn--primary', { text: t('cl_sign_in') });
  const register = el('button.btn.btn--ghost', { text: t('cl_sign_up') });

  enter.onclick = async () => {
    busy(true, [enter, register]);
    note.textContent = '';
    try {
      await cloud.signIn(email.value, pass.value);
      toast(t('cl_welcome'));
      rerender();
    } catch (e) {
      note.textContent = '⚠️ ' + cloudMessage(t, e);
      note.style.color = 'var(--neg)';
    } finally { busy(false, [enter, register]); }
  };

  register.onclick = async () => {
    busy(true, [enter, register]);
    note.textContent = '';
    try {
      const res = await cloud.signUp(email.value, pass.value);
      if (res.needsConfirmation) {
        note.textContent = '📬 ' + t('cl_check_email');
        note.style.color = 'var(--warn)';
      } else {
        toast(t('cl_welcome'));
        rerender();
      }
    } catch (e) {
      note.textContent = '⚠️ ' + cloudMessage(t, e);
      note.style.color = 'var(--neg)';
    } finally { busy(false, [enter, register]); }
  };

  return el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('cl_title') })]),
    el('p.small.muted', { style: { marginBottom: '14px' }, text: t('cl_what') }),
    field(t('cl_email'), email),
    el('div', { style: { height: '10px' } }),
    field(t('cl_password'), pass),
    el('div.hstack', { style: { gap: '9px', marginTop: '14px' } }, [enter, register]),
    note,
    el('p.tiny.muted-3', { style: { marginTop: '12px', lineHeight: '1.5' }, text: t('cl_privacy') }),
  ]);
}

/* ─────────── Вход выполнен ─────────── */

function signedInCard(t, user, runner, rerender) {
  const s = runner?.state || { status: 'idle' };
  const line = el('div.small', { style: { marginTop: '4px' } });

  function paint(st) {
    const key = STATUS_KEY[st.status] || 'sync_idle';
    const when = st.lastAt
      ? ' · ' + new Date(st.lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    line.textContent = t(key) + (st.status === 'ok' ? when : '');
    line.style.color = st.status === 'error' ? 'var(--neg)'
      : st.status === 'ok' ? 'var(--pos)'
      : st.status === 'offline' ? 'var(--warn)' : 'var(--text-2)';
  }
  paint(s);

  const syncNow = el('button.btn.btn--sm.btn--primary', {
    text: t('sync_now'),
    onclick: async () => {
      syncNow.disabled = true;
      paint({ status: 'syncing' });
      const okRes = await runner.sync({ reason: 'manual' });
      paint(runner.state);
      if (okRes) toast(t('sync_done'));
      syncNow.disabled = false;
    },
  });

  return el('div.card', { style: { borderColor: 'var(--accent)' } }, [
    el('div.card__head', {}, [el('div.card__title', { text: t('cl_title') })]),
    el('div.hstack', {}, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { style: { fontWeight: '600', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: user.email }),
        line,
      ]),
      syncNow,
    ]),
    el('p.tiny.muted-3', { style: { marginTop: '12px', lineHeight: '1.5' }, text: t('sync_hint') }),
    el('button.btn.btn--ghost.btn--block', {
      style: { marginTop: '12px' },
      text: t('cl_sign_out'),
      onclick: () => confirmSheet({
        title: t('cl_sign_out'),
        text: t('cl_sign_out_warn'),
        confirmLabel: t('cl_sign_out'), cancelLabel: t('cancel'),
        danger: false,
        onConfirm: () => { cloud.signOut(); toast(t('cl_signed_out_done')); rerender(); },
      }),
    }),
  ]);
}

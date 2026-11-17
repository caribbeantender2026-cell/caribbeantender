type AuthSession = { access_token: string; user: { id: string } };

function sessionId(session: AuthSession): string | null {
  try {
    const payload = session.access_token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown };
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

/** Recovery is scoped to a Supabase session, including across token refreshes. */
export class RecoverySession {
  private id: string | null = null;
  private userId: string | null = null;

  /** Follow token refreshes and end recovery when Auth switches sessions. */
  observe(event: string, session: AuthSession | null) {
    if (event === 'PASSWORD_RECOVERY' && session) {
      this.id = sessionId(session);
      this.userId = session.user.id;
    } else if (!this.matches(session) || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      this.clear();
    }
  }

  /** Whether this session can finish the original recovery. */
  matches(session: AuthSession | null): boolean {
    return !!session && this.id !== null && this.userId === session.user.id && this.id === sessionId(session);
  }

  /** Consume recovery after the password update or a session change. */
  clear() {
    this.id = null;
    this.userId = null;
  }
}

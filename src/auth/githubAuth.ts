import * as vscode from 'vscode';

export const PROVIDER_ID = 'github';
/** Enough to read projects, the private repos their items live in, and the user's organizations. */
export const READ_SCOPES = ['read:project', 'read:org', 'repo'];
/** Requested only the first time we need to write (move a card, edit a field). */
export const WRITE_SCOPES = ['project', 'read:org', 'repo'];

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to GitHub.');
    this.name = 'NotSignedInError';
  }
}

/**
 * Wraps vscode.authentication. Tokens are only held in memory for the duration of a request.
 * A session with write scopes is preferred for reads once it exists, so the user never gets a
 * second sign-in prompt after granting `project`.
 */
export class GitHubAuth implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly auth: typeof vscode.authentication = vscode.authentication) {
    this.subscription = auth.onDidChangeSessions((e) => {
      if (e.provider.id === PROVIDER_ID) this.changed.fire();
    });
  }

  /** Session without prompting, or undefined. */
  async currentSession(): Promise<vscode.AuthenticationSession | undefined> {
    return (
      (await this.auth.getSession(PROVIDER_ID, WRITE_SCOPES, { silent: true })) ??
      (await this.auth.getSession(PROVIDER_ID, READ_SCOPES, { silent: true }))
    );
  }

  /** Interactive sign-in with read scopes. */
  async signIn(): Promise<vscode.AuthenticationSession> {
    const session = await this.auth.getSession(PROVIDER_ID, READ_SCOPES, { createIfNone: true });
    this.changed.fire();
    return session;
  }

  /**
   * Token for a request. Reads never prompt (the tree shows a sign-in welcome instead); writes
   * prompt for the `project` scope the first time.
   */
  async getToken({ write }: { write: boolean }): Promise<string> {
    if (write) {
      const session = await this.auth.getSession(PROVIDER_ID, WRITE_SCOPES, { createIfNone: true });
      return session.accessToken;
    }
    const session = await this.currentSession();
    if (!session) throw new NotSignedInError();
    return session.accessToken;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import * as z from 'zod';
import { readAgentState, saveAgentState, type AgentState, type PendingApproval } from './agent-credentials.js';
import { CLIError } from './cli-error.js';
import { jsonObjectSchema, requireJsonObject, type JsonObject } from './json-object.js';
import { operationRequest } from './operation-arguments.js';
import { documentedOperations, legacyCLIOperation, readOperationCache, saveOperationCache, type Operation } from './operation-catalog.js';
import { cliVersion } from './updates.js';

export { CLIError } from './cli-error.js';
export { jsonObjectRootSchema, type JsonObject } from './json-object.js';
export { legacyCLIOperation, type Operation } from './operation-catalog.js';

export const DEFAULT_ATLAS_URL = 'https://atlas.training';
export type CLIInvocation = { argv: string[]; cwd: string };
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

export type CLIResult = {
  training_permissions?: Array<'read' | 'write'>; ok: true; operation: string; status: number; etag?: string; request_id?: string; replayed?: boolean;
  /** Requests a workout file was sent in, when it needed more than one. */
  parts?: number; data: unknown;
};
type APIResponse = { status: number; headers: Headers; body: unknown };
const accountSchema = z.object({ id: z.string(), email: z.string(), name: z.string() });
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive(), refresh_token: z.string().min(1).optional() });
const deviceSchema = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1), verification_uri_complete: z.string(),
  expires_in: z.number().int().positive().max(86_400), interval: z.number().int().positive().max(3600),
});
const signedOut = 'Run atlas connect to connect this computer to your Atlas account.';
const unreadableResponse = 'The Atlas response could not be read.'
  + ' No request was retried; reuse the same idempotency key if a write may have reached the server.';

export function atlasOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch (cause) { throw new CLIError('invalid_url', 'ATLAS_URL must be an HTTP(S) origin.', { cause }); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) {
    throw new CLIError('invalid_url', 'ATLAS_URL must be an HTTP(S) origin without credentials or a path.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new CLIError('insecure_url', 'Use HTTPS outside a loopback development server.');
  }
  return url.origin;
}
// connect and auth status confirm the account with this one fixed read, without discovering every operation first.
const accountOperation: Operation = { operation: 'get_me', method: 'GET', path: '/v1/me', summary: 'Read the current authenticated user.', parameters: [] };
function formPost(fields: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() };
}

export class AtlasCLIClient {
  readonly baseURL: string;
  readonly configPath: string;
  private readonly operationsPath: string;
  private operationsCache?: Operation[];
  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private transport: typeof fetch = fetch,
    private invocation?: CLIInvocation,
    private authentication: 'default' | 'proxy' = 'default',
  ) {
    this.baseURL = atlasOrigin(env.ATLAS_URL || DEFAULT_ATLAS_URL);
    const directory = env.ATLAS_CONFIG_DIR || join(homedir(), '.config', 'atlas');
    const name = createHash('sha256').update(this.baseURL).digest('hex');
    this.configPath = join(directory, `${name}.json`);
    this.operationsPath = join(directory, `${name}.operations.json`);
  }
  private continuation(command: string): string {
    // Keep relative Node loaders/env files working and carry only non-secret
    // connection settings. Credentials stay in their existing private directory.
    const launch = this.invocation ? `${this.invocation.argv.map(shellQuote).join(' ')}` : 'atlas';
    const directory = this.invocation ? `cd ${shellQuote(this.invocation.cwd)} && ` : '';
    const settings = `ATLAS_URL=${shellQuote(this.baseURL)} ATLAS_CONFIG_DIR=${shellQuote(resolve(dirname(this.configPath)))}`;
    return `${directory}${settings} ${launch} ${command}`;
  }
  private endpoint(value: string): string {
    let url: URL;
    try { url = new URL(value, this.baseURL); }
    catch (cause) { throw new CLIError('invalid_response', 'Atlas advertised a malformed endpoint URL.', { cause }); }
    if (url.origin !== this.baseURL || url.username || url.password || url.hash) {
      throw new CLIError('unsafe_endpoint', 'The server advertised an endpoint outside the configured Atlas origin.');
    }
    return url.href;
  }
  private state(): AgentState {
    return readAgentState(this.configPath, this.baseURL) ?? { version: 2, origin: this.baseURL };
  }
  private get clientId(): string { return `${this.baseURL}/oauth/clients/atlas-cli.json`; }
  private save(state: AgentState): void {
    saveAgentState(this.configPath, state);
  }
  private async request(url: string, init: RequestInit = {}): Promise<APIResponse> {
    const endpoint = this.endpoint(url);
    let response: Response;
    const options: RequestInit = { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) };
    if (this.authentication === 'proxy') options.credentials = 'omit';
    try { response = await this.transport(endpoint, options); }
    catch (cause) {
      const message = 'Atlas could not be reached. No request was retried; reuse the same idempotency key if a write may have reached the server.';
      throw new CLIError('network_error', message, { cause });
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    // Only a conditional read is answered 304, and it has no body.
    if (response.status === 304) return { status: 304, headers: response.headers, body: null };
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (error instanceof SyntaxError) {
        throw new CLIError('invalid_response', 'Atlas returned a non-JSON response.', { status: response.status, requestId, cause: error });
      }
      throw new CLIError('network_error', unreadableResponse, { status: response.status, requestId, cause: error });
    }
    if (!response.ok) this.fail(response.status, body, requestId);
    return { status: response.status, headers: response.headers, body };
  }
  private fail<T>(status: number, body: T, requestId?: string): never {
    const document = jsonObjectSchema.safeParse(body).data ?? {};
    const error = jsonObjectSchema.safeParse(document.error).data ?? document;
    const code = String(error.code ?? z.string().safeParse(document.error).data ?? 'api_error');
    const message = z.string().safeParse(error.message).data ?? 'Atlas rejected the request.';
    throw new CLIError(code, message, { status, details: error.details, requestId: requestId ?? z.string().safeParse(document.request_id).data });
  }
  private result(operation: string, response: APIResponse): CLIResult {
    const result: CLIResult = { ok: true, operation, status: response.status, data: response.body };
    if (operation === 'get_me') {
      const raw = response.headers.get('X-Atlas-Training-Permissions');
      const permissions = raw === null ? undefined : z.array(z.enum(['read', 'write'])).safeParse(raw.split(',').map(value => value.trim()));
      if (permissions?.success && permissions.data.includes('read') && new Set(permissions.data).size === permissions.data.length) {
        result.training_permissions = permissions.data;
      }
    }
    if (response.headers.has('etag')) result.etag = response.headers.get('etag')!;
    if (response.headers.has('x-request-id')) result.request_id = response.headers.get('x-request-id')!;
    if (response.headers.has('idempotency-replayed')) result.replayed = response.headers.get('idempotency-replayed') === 'true';
    return result;
  }
  /**
   * The operations the server documents. The list is kept in the config folder with the document's ETag, and each command
   * revalidates it, so the full document is downloaded only when the server's contract or this CLI's version changed.
   */
  async operations(): Promise<Operation[]> {
    if (this.operationsCache) return this.operationsCache;
    const cli = cliVersion();
    const cached = cli === undefined ? undefined : readOperationCache(this.operationsPath, this.baseURL, cli);
    const response = await this.request('/openapi.json', cached ? { headers: { 'If-None-Match': cached.etag } } : {});
    if (cached && response.status === 304) return this.operationsCache = cached.operations;
    const operations = documentedOperations(requireJsonObject(response.body));
    const etag = response.headers.get('etag');
    if (cli !== undefined && etag) saveOperationCache(this.operationsPath, { origin: this.baseURL, cli, etag, operations });
    return this.operationsCache = operations;
  }
  async discover(): Promise<CLIResult> {
    const data = { url: this.baseURL, operations: await this.operations() };
    return { ok: true, operation: 'discover', status: 200, data };
  }
  async schema(name?: string): Promise<CLIResult> {
    if (!name) return this.result('schema', await this.request('/openapi.json'));
    if (!(await this.operations()).some(operation => operation.operation === name)) {
      throw new CLIError('unknown_operation', 'Unknown operation. Run atlas discover.');
    }
    return this.result('schema', await this.request(`/capabilities/${encodeURIComponent(name)}`));
  }
  async call(name: string, arguments_: JsonObject): Promise<CLIResult> {
    const operation = (await this.operations()).find(operation => operation.operation === name);
    if (!operation) throw new CLIError('unknown_operation', 'Unknown operation. Run atlas discover.');
    return this.execute(operation, arguments_);
  }
  async callLegacy(name: string, arguments_: JsonObject): Promise<CLIResult> {
    const operation = legacyCLIOperation(name);
    if (!operation) throw new CLIError('unknown_operation', 'Unknown compatibility operation.');
    return this.execute(operation, arguments_);
  }
  private async execute(operation: Operation, arguments_: JsonObject): Promise<CLIResult> {
    const name = operation.operation;
    const request = operationRequest(operation, arguments_);
    // The explicitly selected egress-proxy adapter never consults credentials.
    // In the ordinary CLI, a saved connection takes priority, even when a personal
    // API key is present in the environment. A rejected connection must never fall
    // back to a different credential.
    if (this.authentication === 'proxy') return this.result(name, await this.request(request.target, request.init));
    const state = this.state();
    const connected = Boolean(state.refresh_token || state.access_token);
    const token = connected ? await this.accessToken(state) : this.env.ATLAS_API_TOKEN;
    if (!token) throw new CLIError('authentication_required', signedOut);
    request.headers.set('Authorization', `Bearer ${token}`);
    try { return this.result(name, await this.request(request.target, request.init)); } catch (error) {
      // Atlas refuses a disconnected connection's last access token too; forget it.
      if (!connected || !(error instanceof CLIError) || error.status !== 401) throw error;
      this.save({ version: 2, origin: this.baseURL });
      throw new CLIError('authentication_required', `This connection ended. ${signedOut}`, { status: 401, requestId: error.requestId });
    }
  }
  /** A current access token, refreshing it shortly before it expires. */
  private async accessToken(state: AgentState): Promise<string> {
    if (state.access_token && (state.access_expires_at ?? 0) > Date.now() + 30_000) return state.access_token;
    if (!state.refresh_token) throw new CLIError('authentication_required', signedOut);
    try {
      return this.saveTokens(state, (await this.request('/oauth/token', formPost({
        grant_type: 'refresh_token', client_id: this.clientId, refresh_token: state.refresh_token,
      }))).body);
    } catch (error) {
      if (!(error instanceof CLIError) || error.code !== 'invalid_grant') throw error;
      // Another atlas command may have refreshed with the same token first; continue with the tokens it saved.
      const latest = this.state();
      if (latest.refresh_token && latest.refresh_token !== state.refresh_token) return this.accessToken(latest);
      // Otherwise a refused refresh token means the connection ended; keep nothing that looks connected.
      delete state.access_token; delete state.access_expires_at; delete state.refresh_token; this.save(state);
      throw new CLIError('authentication_required', `This connection ended. ${signedOut}`);
    }
  }
  private saveTokens<T>(state: AgentState, body: T): string {
    const tokens = tokenSchema.safeParse(body);
    if (!tokens.success) throw new CLIError('invalid_response', 'Atlas returned invalid sign-in tokens.', { cause: tokens.error });
    state.access_token = tokens.data.access_token;
    state.access_expires_at = Date.now() + tokens.data.expires_in * 1000;
    if (tokens.data.refresh_token) state.refresh_token = tokens.data.refresh_token;
    delete state.pending_approval;
    this.save(state);
    return tokens.data.access_token;
  }
  private approvalURL(value: string): string {
    const url = new URL(this.endpoint(value));
    if (url.pathname !== '/app/agents/device' || !url.searchParams.get('user_code')) {
      throw new CLIError('invalid_response', 'Atlas returned an invalid approval link.');
    }
    return url.href;
  }
  private async startApproval(state: AgentState, invite?: string): Promise<PendingApproval> {
    const form: Record<string, string> = invite === undefined ? { client_id: this.clientId } : { client_id: this.clientId, invite };
    let response: APIResponse;
    try { response = await this.request('/oauth/device_authorization', formPost(form)); } catch (error) {
      if (invite === undefined || !(error instanceof CLIError) || error.code !== 'invalid_grant') throw error;
      throw new CLIError('invite_unavailable', 'This code has expired or was already used. Ask for a new one from the Atlas app.');
    }
    const started = deviceSchema.safeParse(response.body);
    if (!started.success) throw new CLIError('invalid_response', 'Atlas did not return a complete approval link.', { cause: started.error });
    const pending: PendingApproval = {
      device_code: started.data.device_code, user_code: started.data.user_code, url: this.approvalURL(started.data.verification_uri_complete),
      expires_at: Date.now() + started.data.expires_in * 1000, interval: Math.max(5, started.data.interval),
    };
    state.pending_approval = pending; this.save(state);
    return pending;
  }
  /** Ask once whether the person approved. Returns false while still waiting. */
  private async checkApproval(state: AgentState, pending: PendingApproval): Promise<boolean> {
    try {
      this.saveTokens(state, (await this.request('/oauth/token', formPost({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.clientId, device_code: pending.device_code,
      }))).body);
      return true;
    } catch (error) {
      if (!(error instanceof CLIError)) throw error;
      if (error.code === 'authorization_pending') return false;
      if (error.code === 'slow_down') { pending.interval += 5; this.save(state); return false; }
      if (error.code === 'access_denied' || error.code === 'expired_token' || error.code === 'invalid_grant') {
        delete state.pending_approval; this.save(state);
        throw error.code === 'access_denied'
          ? new CLIError('approval_denied', 'The connection was declined. Run atlas connect to ask again.')
          : new CLIError('approval_expired', 'This approval link expired. Run atlas connect again for a fresh link.');
      }
      throw error;
    }
  }
  private async account(): Promise<z.infer<typeof accountSchema>> {
    const account = accountSchema.safeParse((await this.execute(accountOperation, {})).data);
    if (!account.success) throw new CLIError('invalid_response', 'Atlas could not verify the connected account.');
    return account.data;
  }
  private connected(account: z.infer<typeof accountSchema>): CLIResult {
    return { ok: true, operation: 'connect', status: 200, data: { status: 'connected', account, next_command: this.continuation('--skill') } };
  }
  /**
   * Connect with approve-on-phone sign-in: show a link and code, then finish once the person approves. A setup code or trainer
   * invite was approved when the person made it, so it connects at once.
   */
  async connect(waitSeconds = 0, invite?: string): Promise<CLIResult> {
    const state = this.state();
    if (state.refresh_token || state.access_token) {
      try {
        const account = await this.account();
        if (invite === undefined) return this.connected(account);
        throw new CLIError('already_connected', `This computer is already connected to ${account.name}’s Atlas. `
          + 'Run atlas auth logout first, then connect with the invite.');
      } catch (error) {
        if (!(error instanceof CLIError) || error.code !== 'authentication_required') throw error;
      }
    }
    if (invite !== undefined) {
      const approved = await this.startApproval(state, invite);
      if (await this.checkApproval(state, approved)) return this.connected(await this.account());
    }
    let pending = state.pending_approval;
    if (pending && pending.expires_at > Date.now()) {
      this.approvalURL(pending.url);
      if (await this.checkApproval(state, pending)) return this.connected(await this.account());
    } else {
      pending = await this.startApproval(state);
    }
    const deadline = Math.min(Date.now() + waitSeconds * 1000, pending.expires_at);
    while (waitSeconds > 0 && Date.now() + pending.interval * 1000 <= deadline) {
      await new Promise(resolve => setTimeout(resolve, pending!.interval * 1000));
      if (await this.checkApproval(state, pending)) return this.connected(await this.account());
    }
    const next_command = this.continuation(`connect --wait 120 --url ${shellQuote(this.baseURL)}`);
    return { ok: true, operation: 'connect', status: 202, data: {
      status: 'approval_required', approval_url: this.approvalURL(pending.url), code: pending.user_code, next_command,
    } };
  }
  async authStatus(): Promise<CLIResult> {
    const state = this.state();
    let data: JsonObject = { status: 'not_connected', config_path: this.configPath };
    if (state.refresh_token || state.access_token) {
      try { data = { status: 'connected', account: await this.account(), config_path: this.configPath }; } catch (error) {
        if (!(error instanceof CLIError) || error.code !== 'authentication_required') throw error;
      }
    } else if (state.pending_approval && state.pending_approval.expires_at > Date.now()) {
      data = { status: 'approval_required', approval_url: this.approvalURL(state.pending_approval.url), config_path: this.configPath };
    }
    return { ok: true, operation: 'auth_status', status: 200, data };
  }
  /** End this computer's connection on the server, then forget it locally. */
  async authLogout(): Promise<CLIResult> {
    const state = this.state();
    const token = state.refresh_token ?? state.access_token;
    if (token) await this.request('/oauth/revoke', formPost({ client_id: this.clientId, token }));
    this.save({ version: 2, origin: this.baseURL });
    return { ok: true, operation: 'auth_logout', status: 200, data: { status: 'disconnected' } };
  }
}

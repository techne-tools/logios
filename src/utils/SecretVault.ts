import { ensureHermesDir, getProfileDir } from "./zoteroPaths";

/**
 * Secure secret storage for sensitive values like API keys.
 *
 * Secrets are stored in <profile>/hermes-secrets.json with file permissions 0o600.
 * Values are held in-memory for the session to avoid frequent disk I/O.
 */
export class SecretVault {
  private readonly addon: any;
  private secrets: Map<string, string> = new Map();
  private readonly secretFileName = "hermes-secrets.json";

  constructor(addon: any) {
    this.addon = addon;
    // Load existing secrets from file on initialization
    void this.loadSecrets();
  }

  /**
   * Get the path to the secrets file as an nsIFile.
   */
  private getSecretsFile(): any {
    const profileDir = getProfileDir();
    if (!profileDir) {
      throw new Error("Unable to determine profile directory");
    }

    const hermesDir = ensureHermesDir(profileDir, "", this.addon);
    const filePath = hermesDir + "/" + this.secretFileName;
    return Zotero.File.pathToFile(filePath);
  }

  /**
   * Load secrets from the secrets file into memory.
   */
  private async loadSecrets(): Promise<void> {
    try {
      const file = this.getSecretsFile();
      if (!file.exists()) {
        // No secrets file yet, that's okay
        return;
      }

      const content = Zotero.File.getContents(file) as string;
      const parsed = JSON.parse(content);

      if (typeof parsed === "object" && parsed !== null) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") {
            this.secrets.set(key, value);
          }
        }
      }
    } catch (error) {
      // Don't throw - if we can't load secrets, we'll just start with an empty cache
      this.addon.log(
        `[SecretVault] Failed to load secrets: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Save the current in-memory secrets to the secrets file with 0o600 permissions.
   */
  private async saveSecrets(): Promise<void> {
    try {
      const file = this.getSecretsFile();

      // Convert Map to plain object for JSON serialization
      const obj: Record<string, string> = {};
      for (const [key, value] of this.secrets.entries()) {
        obj[key] = value;
      }

      const content = JSON.stringify(obj, null, 2);
      Zotero.File.putContents(file, content);

      // Set file permissions to 0o600 (owner read/write only)
      try {
        file.permissions = 0o600;
      } catch (permError) {
        // Some systems might not support changing permissions via this method
        // Log but don't fail - the file might already have correct permissions
        this.addon.log(
          `[SecretVault] Warning: Could not set file permissions: ${(permError as Error).message}`,
        );
      }
    } catch (error) {
      this.addon.log(
        `[SecretVault] Failed to save secrets: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Store a secret value.
   * @param name - The secret identifier (e.g., "apiKey")
   * @param value - The secret value to store
   */
  public async setSecret(name: string, value: string): Promise<void> {
    if (!name || typeof name !== "string") {
      throw new Error("Secret name must be a non-empty string");
    }

    if (value === undefined || value === null) {
      throw new Error("Secret value must be provided");
    }

    this.secrets.set(name, value);
    await this.saveSecrets();
  }

  /**
   * Retrieve a secret value.
   * @param name - The secret identifier
   * @returns The secret value, or null if not found
   */
  public async getSecret(name: string): Promise<string | null> {
    if (!name || typeof name !== "string") {
      throw new Error("Secret name must be a non-empty string");
    }

    // Return from memory cache if available
    if (this.secrets.has(name)) {
      return this.secrets.get(name) ?? null;
    }

    // If not in memory, try to load from file (in case it was added by another process)
    await this.loadSecrets();
    return this.secrets.get(name) ?? null;
  }

  /**
   * Delete a secret.
   * @param name - The secret identifier to delete
   */
  public async deleteSecret(name: string): Promise<void> {
    if (!name || typeof name !== "string") {
      throw new Error("Secret name must be a non-empty string");
    }

    this.secrets.delete(name);
    await this.saveSecrets();
  }

  /**
   * List all secret names.
   * @returns Array of secret names
   */
  public async listSecrets(): Promise<string[]> {
    // Ensure we have the latest secrets from disk
    await this.loadSecrets();
    return Array.from(this.secrets.keys());
  }
}

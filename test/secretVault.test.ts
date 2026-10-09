import { expect } from "chai";
import { SecretVault } from "../src/utils/SecretVault";

/**
 * Test the SecretVault class.
 *
 * These tests run against the REAL Zotero runtime booted by the test harness.
 */
describe("SecretVault (live Zotero runtime)", function () {
  let vault: SecretVault;
  const testAddon = {
    log: (message: string, ...args: any[]) => {
      console.log(`[SecretVaultTest] ${message}`, ...args);
    },
  };

  beforeEach(async function () {
    vault = new SecretVault(testAddon);
    // Clear any existing secrets for a clean test
    const secrets = await vault.listSecrets();
    for (const secret of secrets) {
      await vault.deleteSecret(secret);
    }
  });

  afterEach(async function () {
    // Clean up after tests
    const secrets = await vault.listSecrets();
    for (const secret of secrets) {
      await vault.deleteSecret(secret);
    }
  });

  it("should store and retrieve a secret", async function () {
    await vault.setSecret("testKey", "testValue");
    const value = await vault.getSecret("testKey");
    expect(value).to.equal("testValue");
  });

  it("should return null for non-existent secret", async function () {
    const value = await vault.getSecret("nonExistentKey");
    expect(value).to.be.null;
  });

  it("should overwrite existing secret", async function () {
    await vault.setSecret("testKey", "originalValue");
    await vault.setSecret("testKey", "newValue");
    const value = await vault.getSecret("testKey");
    expect(value).to.equal("newValue");
  });

  it("should delete a secret", async function () {
    await vault.setSecret("testKey", "testValue");
    await vault.deleteSecret("testKey");
    const value = await vault.getSecret("testKey");
    expect(value).to.be.null;
  });

  it("should list all secrets", async function () {
    await vault.setSecret("key1", "value1");
    await vault.setSecret("key2", "value2");
    await vault.setSecret("key3", "value3");

    const secrets = await vault.listSecrets();
    expect(secrets).to.have.lengthOf(3);
    expect(secrets).to.include("key1");
    expect(secrets).to.include("key2");
    expect(secrets).to.include("key3");
  });

  it("should persist secrets to disk and reload them", async function () {
    // Store a secret
    await vault.setSecret("persistentKey", "persistentValue");

    // Create a new vault instance to simulate restart
    const vault2 = new SecretVault(testAddon);
    const value = await vault2.getSecret("persistentKey");
    expect(value).to.equal("persistentValue");
  });

  it("should handle empty secret values", async function () {
    await vault.setSecret("emptyKey", "");
    const value = await vault.getSecret("emptyKey");
    expect(value).to.equal("");
  });

  it("should handle special characters in secret values", async function () {
    const specialValue = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\\\"\\'";
    await vault.setSecret("specialKey", specialValue);
    const value = await vault.getSecret("specialKey");
    expect(value).to.equal(specialValue);
  });

  it("should throw error for invalid secret name", async function () {
    try {
      await vault.setSecret("", "value");
      expect.fail("Expected error for empty secret name");
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.contain(
        "Secret name must be a non-empty string",
      );
    }

    try {
      await vault.setSecret(null as any, "value");
      expect.fail("Expected error for null secret name");
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.contain(
        "Secret name must be a non-empty string",
      );
    }
  });

  it("should throw error for undefined secret value", async function () {
    try {
      await vault.setSecret("testKey", undefined as any);
      expect.fail("Expected error for undefined secret value");
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.contain(
        "Secret value must be provided",
      );
    }
  });
});

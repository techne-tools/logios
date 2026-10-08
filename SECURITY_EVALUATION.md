# Security Evaluation of Zotero-Hermes Plugin

## Overview
This document summarizes a security evaluation of the Zotero-Hermes plugin, focusing on identifying potential vulnerabilities and assessing the effectiveness of existing security measures.

## Key Security Strengths

### 1. Centralized Write Gate (`src/utils/writeGate.ts`)
- **Enforced Approval Flow**: All Zotero mutations must pass through a three-step process: APPROVE (user consent), APPLY (execution), RECORD (audit logging)
- **User Consent**: Requires explicit user approval for destructive or modifying operations via a diff-based approval dialog
- **Audit Trail**: All operations (successful, rejected, or failed) are recorded in the audit log for accountability
- **Fleet Invariant Compliance**: Respects the constraint that permanent erasure is reserved for the operator outside the plugin
- **Defense in Depth**: Even rejected mutations leave a permission audit trail

### 2. Secure External Communication
- **HermesApiClient**:
  - Uses Bearer token authentication stored in Zotero preferences
  - Implements proper abort controller cleanup to prevent resource leaks
  - Includes exponential backoff reconnection with max attempt limits
  - Validates TLS certificates through standard fetch API
- **HermesClient (ACP)**:
  - Spawns subprocess with explicit argument arrays (no shell injection risk)
  - Controls environment variables without using shell exports
  - Validates binary path through PreferencesManager
  - Implements connection timeouts and heartbeat mechanisms

### 3. Sandbox-Aware Implementation
- **Firefox ESR 140 Compliance**: Code explicitly avoids patterns that crash the Zotero sandbox:
  - No `dangerouslySetInnerHTML` usage (MarkdownRenderer.tsx uses safe React element creation)
  - No `DOMParser` usage (manual string parsing only)
  - Synthetic input event workaround: Uses native `addEventListener` via refs for text inputs
  - State ref pattern: Native callbacks read from `stateRef.current` instead of React state closures
  - Proper clipboard access: Uses Firefox XPCOM `nsIClipboardHelper`

### 4. Dependency Security
- **npm audit**: Reports 0 vulnerabilities in production dependencies
- **Dependency Management**: Uses pinned versions for critical packages (zotero-plugin-toolkit, zotero-types)
- **Build Process**: Uses esbuild with Firefox 140 target for appropriate sandbox compatibility

### 5. Permission Model
- **Manifest.json**: Requests only necessary permissions for the plugin's functionality
- **Preference Storage**: Uses Zotero's built-in preference system which is appropriately sandboxed
- **API Keys**: Stored in encrypted preference storage (via Zotero.Prefs) rather than plain files

### 6. Agent Safety Guidelines
- **System Instructions**: Explicitly instruct the agent to:
  - NOT search online or attempt to read the SQLite database
  - ANSWER DIRECTLY using provided metadata
  - This prevents hallucinations and unauthorized data access attempts

## Areas for Continued Vigilance

### 1. API Key Management
- While API keys are stored in Zotero's preference system (which is appropriately protected), consider:
  - Regular rotation reminders in documentation
  - Clear UI indication when API keys are configured
  - Option to clear keys from the preferences UI

### 2. External Service Trust Boundaries
- The plugin trusts the Hermes API endpoint to behave correctly
- Consider additional validation of API responses to prevent injection attacks
- Ensure proper error handling doesn't leak sensitive information in error messages

### 3. File System Access
- While the writeGate provides strong protection for Zotero library mutations:
  - Ensure any temporary file creation (if any) is properly secured and cleaned up
  - Verify that export functionality properly validates file paths

### 4. Version Maintenance
- Keep dependencies updated to address any newly discovered vulnerabilities
- Monitor Zotero SDK/security advisories for platform-specific concerns

## Conclusion
The Zotero-Hermes plugin demonstrates strong security practices appropriate for its role as a Zotero extension operating in a Firefox sandbox environment. The centralized write gate represents a particularly robust security control that prevents unauthorized library modifications. The code shows careful consideration of the Zotero sandbox constraints and avoids common JavaScript security anti-patterns.

No critical vulnerabilities were identified during this evaluation. The plugin appears to be designed with security as a priority rather than an afterthought.

**Recommendation**: Continue maintaining the current security-focused approach, particularly the write gate pattern and sandbox-aware implementation practices.
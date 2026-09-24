# BWM Client Chat

BWM Client Chat is the WordPress-facing interface for Better Web Management Command Center.

The plugin intentionally does **not** run an LLM or privileged agent inside WordPress. It provides the authenticated user interface, current-page context, optional element selection, and server-to-server transport to Command Center.

## Architecture

```text
WordPress user
  -> BWM Client Chat plugin
  -> https://bwmxdev.com/api/client-chat
  -> Command Center site-chat runtime
  -> external HTTP/browser inspection + BWM Remote Management
  -> authenticated website
```

Command Center owns agent execution, model credentials, client context, permissions, auditability, scoped credential lifecycle, and privileged environment access.

## Security boundaries

- Browser JavaScript never receives the BWM Chat site credential.
- Browser JavaScript never receives the BWM Remote token, Command Center master token, SSH password, model keys, or Cloudflare credentials.
- WordPress AJAX requires a logged-in user, an allowed WordPress role, and a WordPress nonce.
- Plugin configuration and connection details are admin-only (`manage_options`).
- The site credential is masked in wp-admin.
- Command Center issues a `site_client` scoped credential after one-time BWM Remote ownership proof; WordPress does not invent or manage a parallel API-key system.
- The credential is bound to one Command Center client/site and can be revoked through Command Center Security.
- The PHP plugin forwards that site-scoped credential to Command Center server-to-server.
- Current page URL and selected-element metadata are context only. Command Center independently validates the site origin and treats page content as untrusted evidence.
- Actual tools are capability-gated (`site:chat`, `site:inspect`, `site:content:write`).
- Client chat does not receive SSH, wp-cli, raw shell, DNS, CDN, deployment, file-write, database-query, or WordPress option-write tools.
- Command Center can still use its external HTTP/browser diagnostics if WordPress REST/BWM Remote is unavailable.
- Mutating site tools are written to Command Center's append-only service audit log; visual changes are not reported as verified unless a post-change inspection/screenshot actually runs.

## Requirements

- WordPress with HTTPS
- BWM Remote Management connected for initial site ownership proof and WordPress operations
- The site/client registered in BWM Command Center
- Outbound HTTPS access from WordPress to `https://bwmxdev.com`

## Installation

1. Copy this repository into `wp-content/plugins/bwm-client-chat/`.
2. Activate **BWM Client Chat** in WordPress.
3. Open **BWM Chat** in wp-admin as an administrator.
4. The plugin sends a one-time BWM Remote ownership proof to Command Center. Command Center issues the scoped site credential, and the plugin stores it server-side.
5. Enable the widget and choose which WordPress roles may use it.

The default API endpoint is:

```text
https://bwmxdev.com/api/client-chat
```

For controlled development only, it can be overridden before plugin load:

```php
define('BWM_CLIENT_CHAT_API_ENDPOINT', 'https://your-command-center.example/api/client-chat');
```

## User workflow

A permitted logged-in user can:

- ask questions about the current page
- ask Command Center to inspect the site externally
- click **Select** and choose a page element before describing a change
- request permitted WordPress content/meta changes
- receive structured change and verification status cards

If a request needs server, DNS, CDN, deployment, or another privileged infrastructure mutation, Command Center escalates it instead of silently giving those capabilities to the WordPress chat session.

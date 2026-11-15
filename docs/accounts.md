# Accounts

Everyone signs in with an email address and password; there is no self-service sign-up. Accounts hold one of two roles: administrators maintain the account directory under Users, and members use the workbench. Every user changes their own password under Account; administrators reset passwords for other accounts under Users. Suspending an account ends its sessions and refuses sign-in and the tokens of its [personal Workers](seedctl.md#workers) until it is reinstated; deleting one removes the account, its sessions and its personal Workers and leaves experiment records untouched.

Bootstrap credentials and the public origin are configured in the shared authentication block of [the environment example](../.env.example).

Authentication is [Better Auth](https://better-auth.com) over the application database, served at `/api/auth/*`. Programmatic access belongs to accounts too: under Integrations every account issues personal API keys for Experiment records, Image annotation and Dataset transfer and reviews the MCP clients it has authorized. Machine enrollment is described in [seedctl](seedctl.md#workers).

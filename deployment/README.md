# EmailClient – Azure Deployment

This folder contains the **Bicep** infrastructure-as-code scripts and supporting
files for deploying the EmailClient app to **Azure App Service (Free tier F1)**.

---

## Files

| File | Purpose |
|---|---|
| `main.bicep` | Defines the App Service Plan (F1/Free, Linux) and the Web App resource |
| `parameters.json` | Default parameter values used by the Bicep template |

---

## Prerequisites

| Tool | Install |
|---|---|
| Azure CLI ≥ 2.55 | https://learn.microsoft.com/cli/azure/install-azure-cli |
| Bicep CLI (bundled with Azure CLI) | `az bicep install` |

---

## Manual deployment

```bash
# 1. Log in
az login

# 2. Create a resource group (once)
az group create \
  --name emailclient-rg \
  --location eastus

# 3. Deploy infrastructure
az deployment group create \
  --resource-group emailclient-rg \
  --template-file deployment/main.bicep \
  --parameters deployment/parameters.json

# 4. Deploy application code
az webapp deploy \
  --resource-group emailclient-rg \
  --name emailclient \
  --src-path . \
  --type zip
```

---

## CI/CD pipeline

The GitHub Actions workflow at `.github/workflows/azure-deploy.yml` automates
the full build-and-deploy cycle.

### Required GitHub secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `AZURE_CREDENTIALS` | JSON output of `az ad sp create-for-rbac` (see below) |
| `AZURE_SUBSCRIPTION_ID` | Your Azure subscription GUID |
| `AZURE_RESOURCE_GROUP` | Name of the resource group (e.g. `emailclient-rg`) |
| `SESSION_SECRET` | Express session secret (random string) |
| `GMAIL_CLIENT_ID` | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Google OAuth client secret |
| `OUTLOOK_CLIENT_ID` | Azure AD app client ID |
| `OUTLOOK_CLIENT_SECRET` | Azure AD app client secret |
| `OUTLOOK_TENANT_ID` | Azure AD tenant ID (or `common`) |
| `ZOHO_CLIENT_ID` | Zoho OAuth client ID |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth client secret |
| `OPENAI_API_KEY` | OpenAI API key (leave empty if using stub mode) |

### Create the service principal

```bash
az ad sp create-for-rbac \
  --name "emailclient-deploy-sp" \
  --role contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/emailclient-rg \
  --sdk-auth
```

Copy the full JSON output and store it as the `AZURE_CREDENTIALS` secret.

---

## Free tier limitations

* **Always On** is disabled (app sleeps after ~20 min of inactivity).
* Maximum 60 CPU minutes / day and 1 GB storage.
* Custom domains and SSL certificates require at least the Shared (D1) tier.
* Upgrade the SKU in `main.bicep` (`B1` → Basic, `S1` → Standard) when you
  outgrow the Free tier.

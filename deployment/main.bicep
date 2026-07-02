// ─────────────────────────────────────────────────────────────────────────────
// EmailClient – Azure Web App deployment (Free tier F1)
// ─────────────────────────────────────────────────────────────────────────────

@description('Base name used to derive all resource names.')
param appName string = 'emailclient'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Node.js runtime version used by the Web App.')
param nodeVersion string = 'NODE|22-lts'

// ── App Service Plan (Free tier) ─────────────────────────────────────────────
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${appName}-plan'
  location: location
  sku: {
    name: 'F1'
    tier: 'Free'
  }
  kind: 'linux'
  properties: {
    reserved: true // required for Linux plans
  }
}

// ── Web App ───────────────────────────────────────────────────────────────────
resource webApp 'Microsoft.Web/sites@2023-01-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeVersion
      appCommandLine: 'node src/server.js'
      alwaysOn: false // not available on Free tier
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        // ── Secrets – set these in GitHub Actions / Azure Portal ──────────
        // SESSION_SECRET, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
        // OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_TENANT_ID,
        // ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, OPENAI_API_KEY
        // are injected at deploy time via the pipeline; do NOT hard-code them.
      ]
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
@description('Default hostname of the deployed Web App.')
output webAppHostname string = webApp.properties.defaultHostName

@description('Resource ID of the Web App.')
output webAppResourceId string = webApp.id

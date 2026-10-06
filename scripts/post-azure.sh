#!/usr/bin/env bash
# Registers Post in your own Microsoft Entra directory (what the Azure portal's "App registrations, New registration" form does, with the right
# settings already filled in) and prints its Application (client) ID. Safe to run again: it updates the app it made before.
#
# Run it in Azure Cloud Shell (https://shell.azure.com, choose Bash), which is already signed in as you:
#   bash post-azure.sh https://your-site.example/post/
set -euo pipefail

REDIRECT="${1:-}"
case "$REDIRECT" in
  https://*/post/) ;;
  *) echo "Usage: bash post-azure.sh https://<your site>/post/   (the address of Post, with the slash at the end)" >&2; exit 2 ;;
esac

GRAPH=00000003-0000-0000-c000-000000000000 # Microsoft Graph

# The delegated permission ids, looked up by name; the well-known id is the fallback if the lookup is not available.
scope() {
  local id
  id=$(az ad sp show --id "$GRAPH" --query "oauth2PermissionScopes[?value=='$1'].id | [0]" -o tsv 2>/dev/null || true)
  echo "${id:-$2}"
}
USER_READ=$(scope User.Read e1fe6dd8-ba31-4d61-89e7-88639da4683d)
OFFLINE=$(scope offline_access 7427e0e9-2fba-42fe-b0c0-848c9e6a8182)
MAIL_READ=$(scope Mail.Read 570282fd-fa5c-430d-a7fd-fc8dc98a9dca)
MAIL_RW=$(scope Mail.ReadWrite 024d486e-b451-40bb-833d-3e66d98c5c73)
MAIL_SEND=$(scope Mail.Send e383f46e-2787-4529-855e-0e479a3ffac0)

# Work and school accounts plus personal accounts; a "mobile and desktop" (public client) redirect, so sign-ins last 90 days and no secret exists.
BODY=$(cat <<JSON
{
  "displayName": "Post",
  "signInAudience": "AzureADandPersonalMicrosoftAccount",
  "api": { "requestedAccessTokenVersion": 2 },
  "isFallbackPublicClient": true,
  "publicClient": { "redirectUris": ["$REDIRECT"] },
  "requiredResourceAccess": [ { "resourceAppId": "$GRAPH", "resourceAccess": [
    { "id": "$USER_READ", "type": "Scope" },
    { "id": "$OFFLINE", "type": "Scope" },
    { "id": "$MAIL_READ", "type": "Scope" },
    { "id": "$MAIL_RW", "type": "Scope" },
    { "id": "$MAIL_SEND", "type": "Scope" }
  ] } ]
}
JSON
)

EXISTING=$(az ad app list --display-name Post --query "[?displayName=='Post'] | [0].appId" -o tsv 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications(appId='$EXISTING')" --headers Content-Type=application/json --body "$BODY" >/dev/null
  APPID="$EXISTING"
else
  APPID=$(az rest --method POST --uri https://graph.microsoft.com/v1.0/applications --headers Content-Type=application/json --body "$BODY" --query appId -o tsv)
fi

echo
echo "Done. Your Application (client) ID is:"
echo
echo "    $APPID"
echo
echo "Send it to Claude, or run this in the Supabase SQL editor (put your Outlook address in):"
echo "    select post_setup('$APPID', 'you@outlook.com');"

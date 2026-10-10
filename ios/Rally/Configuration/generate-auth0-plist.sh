#!/bin/sh
set -eu

# Auth0Provider reads this exact resource name. Configuration is public, but
# blank defaults must stay blank so LiveConfiguration disables live sign-in.
resource_dir="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
configuration_path="${resource_dir}/Auth0.plist"
mkdir -p "$resource_dir"
/usr/bin/plutil -create xml1 "$configuration_path"
/usr/bin/plutil -insert Domain -string "${AUTH0_DOMAIN:-}" "$configuration_path"
/usr/bin/plutil -insert ClientId -string "${AUTH0_CLIENT_ID:-}" "$configuration_path"

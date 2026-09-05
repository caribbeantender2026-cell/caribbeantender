// CaribbeanTender shared Supabase authentication helpers.
// Load order: Supabase CDN -> supabase-config.js -> auth.js -> app.js

function authClient() {
  if (!window.supabaseClient) {
    throw new Error('Supabase client is not available. Check assets/supabase-config.js and the script load order.');
  }
  return window.supabaseClient;
}

async function getCurrentUser() {
  try {
    const { data, error } = await authClient().auth.getUser();
    if (error) {
      console.error('Unable to retrieve current user:', error.message);
      return null;
    }
    return data?.user || null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getUserProfile(userArg) {
  const user = userArg || await getCurrentUser();
  if (!user) return null;

  const client = authClient();
  let { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Unable to retrieve profile:', error.message);
    return null;
  }

  // Compatibility for accounts created before the profile trigger existed.
  if (!data) {
    const accountType = String(user.user_metadata?.account_type || '').toLowerCase();
    if (!['business', 'supplier'].includes(accountType)) return null;

    const fallback = {
      id: user.id,
      full_name: user.user_metadata?.full_name || '',
      email: user.email || '',
      account_type: accountType
    };

    const created = await client
      .from('profiles')
      .upsert(fallback, { onConflict: 'id' })
      .select('*')
      .single();

    if (created.error) {
      console.error('Unable to create missing profile:', created.error.message);
      return null;
    }
    data = created.data;
  }

  return data;
}

function profileDisplayName(profile, fallback) {
  return profile?.company_name || profile?.full_name || fallback || 'Your Account';
}

function renderProfileName(profile, fallback) {
  const name = profileDisplayName(profile, fallback);
  document.querySelectorAll('.currentProfileName').forEach((el) => {
    el.textContent = name;
  });
}

async function logoutUser() {
  try {
    const { error } = await authClient().auth.signOut();
    if (error) throw error;
    window.location.href = 'login.html';
  } catch (error) {
    alert('Unable to log out: ' + (error.message || error));
  }
}

async function requireRole(expectedRole) {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    return null;
  }

  const profile = await getUserProfile(user);
  if (!profile) {
    alert('Your account authenticated, but its CaribbeanTender profile could not be loaded. Check the profiles table and RLS policies in Supabase.');
    return null;
  }

  const role = String(profile.account_type || '').toLowerCase();
  if (role !== expectedRole) {
    window.location.href = role === 'business' ? 'business-dashboard.html' : 'supplier-dashboard.html';
    return null;
  }

  renderProfileName(profile, expectedRole === 'business' ? 'Business Name' : 'Supplier Name');
  return profile;
}

async function requireBusiness() { return requireRole('business'); }
async function requireSupplier() { return requireRole('supplier'); }

async function renderSignedInAccount() {
  const box = document.getElementById('signedInAccount');
  if (!box) return;
  const user = await getCurrentUser();
  if (!user) return;
  const profile = await getUserProfile(user);
  if (!profile) return;

  const role = String(profile.account_type || '').toLowerCase();
  const isBusiness = role === 'business';
  const dashboard = isBusiness ? 'business-dashboard.html' : 'supplier-dashboard.html';
  const label = isBusiness ? 'Business Account' : 'Supplier Account';
  box.innerHTML = `<div class="notice"><strong>${escapeHtml(profileDisplayName(profile, 'Your Account'))}</strong> — ${label} &nbsp; <a href="${dashboard}">Go to Dashboard</a> &nbsp; <button type="button" class="btn" onclick="logoutUser()">Logout</button></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

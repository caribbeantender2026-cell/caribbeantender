// CaribbeanTender shared Supabase authentication helpers.
// Requires supabase-config.js to load first and create window.supabaseClient.

async function getCurrentUser() {
  const { data, error } = await window.supabaseClient.auth.getUser();
  if (error) {
    console.error('Unable to retrieve current user:', error.message);
    return null;
  }
  return data.user || null;
}

async function getUserProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await window.supabaseClient
    .from('profiles')
    .select('id, full_name, company_name, company_address, phone, email, description, industry_category, account_type, created_at')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Unable to retrieve profile:', error.message);
    return null;
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
  const { error } = await window.supabaseClient.auth.signOut();
  if (error) {
    alert('Unable to log out: ' + error.message);
    return;
  }
  window.location.href = 'login.html';
}

async function requireRole(expectedRole) {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }

  const profile = await getUserProfile();
  if (!profile) {
    alert('Your account profile could not be loaded. Please contact support.');
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }

  if (profile.account_type !== expectedRole) {
    window.location.href = profile.account_type === 'business'
      ? 'business-dashboard.html'
      : 'supplier-dashboard.html';
    return null;
  }

  renderProfileName(
    profile,
    expectedRole === 'business' ? 'Business Name' : 'Supplier Name'
  );
  return profile;
}

async function requireBusiness() {
  return requireRole('business');
}

async function requireSupplier() {
  return requireRole('supplier');
}

async function renderSignedInAccount() {
  const box = document.getElementById('signedInAccount');
  if (!box) return;

  const user = await getCurrentUser();
  if (!user) return;

  const profile = await getUserProfile();
  if (!profile) return;

  const name = profileDisplayName(profile, 'Your Account');
  const isBusiness = profile.account_type === 'business';
  const dashboard = isBusiness ? 'business-dashboard.html' : 'supplier-dashboard.html';
  const label = isBusiness ? 'Business Account' : 'Supplier Account';

  box.innerHTML = `
    <div class="notice">
      <strong>${escapeHtml(name)}</strong> — ${label}
      &nbsp; <a href="${dashboard}">Go to Dashboard</a>
      &nbsp; <button type="button" class="btn" onclick="logoutUser()">Logout</button>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

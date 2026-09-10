// CaribbeanTender shared Supabase authentication helpers.
// One Supabase Auth user per email.
// Each user can have at most one Business profile and one Supplier profile.

function authClient() {
  if (!window.supabaseClient) {
    throw new Error('Supabase client is not available. Check assets/supabase-config.js and script order.');
  }
  return window.supabaseClient;
}

async function getCurrentUser() {
  try {
    const { data, error } = await authClient().auth.getUser();
    if (error) return null;
    return data?.user || null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getBaseProfile(userArg) {
  const user = userArg || await getCurrentUser();
  if (!user) return null;
  const { data, error } = await authClient()
    .from('profiles')
    .select('id, full_name, email, created_at')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error('Base profile error:', error.message);
    return null;
  }
  return data;
}

async function getBusinessProfile(userArg) {
  const user = userArg || await getCurrentUser();
  if (!user) return null;
  const { data, error } = await authClient()
    .from('business_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('Business profile error:', error.message);
    return null;
  }
  return data;
}

async function getSupplierProfile(userArg) {
  const user = userArg || await getCurrentUser();
  if (!user) return null;
  const { data, error } = await authClient()
    .from('supplier_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('Supplier profile error:', error.message);
    return null;
  }
  return data;
}

async function getAccountMemberships(userArg) {
  const user = userArg || await getCurrentUser();
  if (!user) return { user:null, business:null, supplier:null, hasBusiness:false, hasSupplier:false };
  const [business, supplier] = await Promise.all([
    getBusinessProfile(user),
    getSupplierProfile(user)
  ]);
  return {
    user,
    business,
    supplier,
    hasBusiness: !!business,
    hasSupplier: !!supplier
  };
}

function accountDisplayName(profile, fallback) {
  return profile?.company_name || fallback || 'Your Account';
}

function renderProfileName(profile, fallback) {
  const name = accountDisplayName(profile, fallback);
  document.querySelectorAll('.currentProfileName').forEach(el => el.textContent = name);
}

async function logoutUser() {
  const { error } = await authClient().auth.signOut();
  if (error) {
    alert('Unable to log out: ' + error.message);
    return;
  }
  location.href = 'login.html';
}

async function createRoleAccount(role) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Please log in first.');
  if (!['business','supplier'].includes(role)) throw new Error('Invalid account type.');

  const table = role === 'business' ? 'business_profiles' : 'supplier_profiles';
  const { data: existing, error: lookupError } = await authClient()
    .from(table).select('user_id').eq('user_id', user.id).maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data, error } = await authClient()
    .from(table)
    .insert({ user_id:user.id, contact_email:user.email || '' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function addOtherAccount(role) {
  await createRoleAccount(role);
  location.href = role === 'business' ? 'business-profile.html' : 'supplier-profile.html';
}

async function requireRole(expectedRole) {
  const user = await getCurrentUser();
  if (!user) {
    const next = location.pathname.split('/').pop() + location.search;
    location.href = 'login.html?next=' + encodeURIComponent(next);
    return null;
  }

  const profile = expectedRole === 'business'
    ? await getBusinessProfile(user)
    : await getSupplierProfile(user);

  if (!profile) {
    const m = await getAccountMemberships(user);
    if (expectedRole === 'business' && m.hasSupplier) {
      location.href = 'supplier-dashboard.html';
      return null;
    }
    if (expectedRole === 'supplier' && m.hasBusiness) {
      location.href = 'business-dashboard.html';
      return null;
    }
    alert('This email does not yet have a ' + expectedRole + ' account.');
    location.href = 'login.html';
    return null;
  }

  renderProfileName(profile, expectedRole === 'business' ? 'Business Name' : 'Supplier Name');
  await renderAccountSwitcher(expectedRole);
  return profile;
}

async function requireBusiness() { return requireRole('business'); }
async function requireSupplier() { return requireRole('supplier'); }

async function renderAccountSwitcher(currentRole) {
  const actions = document.querySelector('.profile-actions');
  if (!actions || actions.dataset.accountSwitcherReady === 'true') return;

  const m = await getAccountMemberships();
  if (!m.user) return;

  actions.dataset.accountSwitcherReady = 'true';
  const otherRole = currentRole === 'business' ? 'supplier' : 'business';
  const hasOther = otherRole === 'business' ? m.hasBusiness : m.hasSupplier;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn outline';

  if (hasOther) {
    button.textContent = otherRole === 'business' ? 'Switch to Business' : 'Switch to Supplier';
    button.addEventListener('click', () => {
      location.href = otherRole === 'business' ? 'business-dashboard.html' : 'supplier-dashboard.html';
    });
  } else {
    button.textContent = otherRole === 'business' ? 'Create Business Account' : 'Create Supplier Account';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = 'Please wait...';
      try {
        await addOtherAccount(otherRole);
      } catch (error) {
        alert('Unable to create account: ' + (error.message || error));
        button.disabled = false;
        button.textContent = oldText;
      }
    });
  }

  const logoutButton = actions.querySelector('.logout-btn');
  if (logoutButton) actions.insertBefore(button, logoutButton);
  else actions.appendChild(button);
}

async function renderSignedInAccount() {
  const box = document.getElementById('signedInAccount');
  if (!box) return;

  const m = await getAccountMemberships();
  if (!m.user) return;

  const base = await getBaseProfile(m.user);
  const name = base?.full_name || m.user.email || 'Signed-in user';
  const links = [];
  if (m.hasBusiness) links.push('<a href="business-dashboard.html">Business Dashboard</a>');
  if (m.hasSupplier) links.push('<a href="supplier-dashboard.html">Supplier Dashboard</a>');

  box.innerHTML = '<div class="notice"><strong>' + escapeHtml(name) + '</strong> &nbsp; ' +
    links.join(' &nbsp; | &nbsp; ') +
    ' &nbsp; <button type="button" class="btn" onclick="logoutUser()">Logout</button></div>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

/**
 * Gives a signed-in user a 60-second download link for one document (PRD P1-05, 8.5). The database
 * decides and logs the request as that user (request_document_download); only then does the service
 * role sign the link, because no user can read the stored files directly.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const signedUrlLifetimeSeconds = 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The link is fetched with the user's bearer token, never cookies, so any origin may call this.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return reply(405, { error: 'Send a POST request with a document_id.' });
  }
  const authorization = request.headers.get('Authorization') ?? '';
  const body: unknown = await request.json().catch(() => null);
  const documentId = body && typeof body === 'object' && 'document_id' in body ? String(body.document_id) : '';
  if (!uuidPattern.test(documentId)) {
    return reply(400, { error: 'document_id must be a document id.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const allowed = await asUser.rpc('request_document_download', { document_id: documentId });
  if (allowed.error) {
    // "Document not found." covers both missing and not yours, so ids can't be probed.
    return reply(404, { error: allowed.error.message });
  }
  const location = allowed.data as { bucket: string; path: string; file_name: string };

  const asService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const signed = await asService.storage
    .from(location.bucket)
    .createSignedUrl(location.path, signedUrlLifetimeSeconds, { download: location.file_name });
  if (signed.error || !signed.data) {
    return reply(500, { error: 'The file could not be prepared for download. Try again in a minute.' });
  }
  return reply(200, { url: signed.data.signedUrl });
});

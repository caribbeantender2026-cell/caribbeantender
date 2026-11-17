-- The client's four forms as Word files, to download, fill in on a laptop or print, and upload with
-- the tender or bid (Rockell, 17 Nov 2026). The files are her Google Docs exported as .docx and
-- uploaded to the form-templates bucket at these paths; signed-in users can download them.
update public.form_definitions set download_path = 'caribbeantender-tender-creation-form.docx' where key = 'business-requirements' and version = 2;
update public.form_definitions set download_path = 'caribbeantender-bid-submission-form.docx' where key = 'supplier-proposal' and version = 2;
update public.form_definitions set download_path = 'caribbeantender-business-registration-form.docx' where key = 'business-registration' and version = 1;
update public.form_definitions set download_path = 'caribbeantender-supplier-registration-form.docx' where key = 'supplier-registration' and version = 1;

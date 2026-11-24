-- Rockell's changes to the Tender Creation and Bid Submission forms (her corrected review document,
-- 24 Nov 2026). Both become version 3; anything saved under version 2 keeps version 2, and the site
-- offers the newest version for new forms.
--
-- Tender Creation Form (business-requirements v3):
--   * every Buyer information field, the contract duration and dates, "Suppliers must submit" and the
--     five procurement timeline dates are required; the dates are labelled "Expected/Estimated";
--   * the budget types are Fixed Budget, Budget Range and Open Competitive Bidding, and each amount
--     appears, and is required, only for the type that uses it (the new showWhen rule below);
--   * the Evaluation criteria table is removed (buyers will get a separate scorecard);
--   * a required clarification email, shown to bidders with the rest of the form;
--   * her five terms replace the old list, and each must be ticked to publish.
-- Bid Submission Form (supplier-proposal v3): the start and completion dates and at least one
-- milestone are required, and a milestone's target date is a calendar date.
--
-- Each new version keeps version 2's Word download (none where the file was never uploaded); the
-- Word files themselves still show the old layout until they are redone.

-- A field with showWhen applies only while another field has that answer. One that doesn't apply is
-- skipped: never required, and an answer left in it from before (an amount typed under another budget
-- type) is ignored. Mirrors isShown in src/lib/forms.ts. Table columns already accept the date type,
-- since private.form_value_problem checks dates by type.
create or replace function private.form_data_problems(form_schema jsonb, form_data jsonb, require_complete boolean)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  maximum_table_rows constant integer := 200;
  problems text[] := '{}';
  field_definition jsonb;
  column_definition jsonb;
  field_value jsonb;
  table_row jsonb;
  row_number integer;
  known_field_names text[] := '{}';
  known_column_names text[];
  data_key text;
  problem text;
  field_label text;
begin
  if jsonb_typeof(form_data) <> 'object' then
    return array['The form data is not in the expected format.'];
  end if;

  for field_definition in select element from jsonb_array_elements(form_schema -> 'fields') as element loop
    known_field_names := known_field_names || (field_definition ->> 'name');
    if field_definition ? 'showWhen'
       and (form_data ->> (field_definition #>> '{showWhen,field}')) is distinct from (field_definition #>> '{showWhen,equals}') then
      continue;
    end if;
    field_label := coalesce(field_definition ->> 'label', field_definition ->> 'name');
    field_value := form_data -> (field_definition ->> 'name');

    if private.form_value_is_empty(field_value) then
      if require_complete and coalesce((field_definition ->> 'required')::boolean, false) then
        problems := problems || format('%s is required.', field_label);
      end if;
      continue;
    end if;

    if field_definition ->> 'type' <> 'table' then
      problem := private.form_value_problem(field_definition, field_value);
      if problem is not null then
        problems := problems || problem;
      end if;
      continue;
    end if;

    if jsonb_typeof(field_value) <> 'array' then
      problems := problems || format('%s must be a list of rows.', field_label);
      continue;
    end if;
    if jsonb_array_length(field_value) > maximum_table_rows then
      problems := problems || format('%s can have at most %s rows.', field_label, maximum_table_rows);
      continue;
    end if;

    known_column_names := array(select column_element ->> 'name' from jsonb_array_elements(field_definition -> 'columns') as column_element);
    row_number := 0;
    for table_row in select element from jsonb_array_elements(field_value) as element loop
      row_number := row_number + 1;
      if jsonb_typeof(table_row) <> 'object' then
        problems := problems || format('Row %s of %s is not in the expected format.', row_number, field_label);
        continue;
      end if;
      for column_definition in select element from jsonb_array_elements(field_definition -> 'columns') as element loop
        if private.form_value_is_empty(table_row -> (column_definition ->> 'name')) then
          if require_complete and coalesce((column_definition ->> 'required')::boolean, false) then
            problems := problems || format('Row %s of %s: %s is required.', row_number, field_label,
              coalesce(column_definition ->> 'label', column_definition ->> 'name'));
          end if;
          continue;
        end if;
        problem := private.form_value_problem(column_definition, table_row -> (column_definition ->> 'name'));
        if problem is not null then
          problems := problems || format('Row %s of %s: %s', row_number, field_label, problem);
        end if;
      end loop;
      for data_key in select key from jsonb_object_keys(table_row) as key loop
        if not data_key = any (known_column_names) then
          problems := problems || format('Row %s of %s has an unknown column "%s".', row_number, field_label, data_key);
        end if;
      end loop;
    end loop;
  end loop;

  for data_key in select key from jsonb_object_keys(form_data) as key loop
    if not data_key = any (known_field_names) then
      problems := problems || format('The form has no field called "%s".', data_key);
    end if;
  end loop;

  return problems;
end;
$$;

insert into public.form_definitions (key, version, title, audience, is_draft, download_path, schema) values
  ('business-requirements', 3, 'Tender Creation Form', 'business', false,
   (select download_path from public.form_definitions where key = 'business-requirements' and version = 2),
   '{"description": "The tender''s title, category and closing date and time are set on the tender itself. Use this form for everything else suppliers need to know.", "fields": [{"label": "Tender type", "name": "tender_type", "options": ["Goods", "Services", "Goods & Services"], "required": true, "section": "Tender information", "type": "choice"}, {"label": "Company name", "name": "company_name", "required": true, "section": "Buyer information", "type": "text"}, {"label": "Tax Registration Number (TRN)", "name": "trn", "section": "Buyer information", "type": "text", "required": true}, {"label": "Contact person", "name": "contact_person", "required": true, "section": "Buyer information", "type": "text"}, {"label": "Position/job title", "name": "contact_position", "section": "Buyer information", "type": "text", "required": true}, {"label": "Email address", "name": "contact_email", "required": true, "section": "Buyer information", "type": "email"}, {"label": "Telephone number", "name": "contact_phone", "required": true, "section": "Buyer information", "type": "text"}, {"label": "Company address", "name": "company_address", "section": "Buyer information", "type": "text", "required": true}, {"label": "Project summary: the goods and/or services required", "name": "project_summary", "required": true, "section": "Project overview", "type": "textarea"}, {"label": "Detailed scope of work: deliverables, quantities, standards, locations and special requirements", "name": "scope_of_work", "required": true, "section": "Project overview", "type": "textarea"}, {"label": "Project location(s)", "name": "project_location", "required": true, "section": "Location of work", "type": "text"}, {"label": "Parish", "name": "parishes", "options": ["Kingston", "St. Andrew", "St. Catherine", "Clarendon", "Manchester", "St. Elizabeth", "Westmoreland", "Hanover", "St. James", "Trelawny", "St. Ann", "St. Mary", "Portland", "St. Thomas"], "required": true, "section": "Location of work", "type": "checkboxes"}, {"label": "Contract type", "name": "contract_type", "options": ["One-Time Project", "Monthly Service Agreement", "Annual Service Agreement", "Multi-Year Contract"], "required": true, "section": "Contract details", "type": "choice"}, {"label": "Contract duration", "name": "contract_duration", "section": "Contract details", "type": "text", "required": true}, {"label": "Expected/Estimated start date", "name": "expected_start_date", "section": "Contract details", "type": "date", "required": true}, {"label": "Expected/Estimated completion date", "name": "expected_completion_date", "section": "Contract details", "type": "date", "required": true}, {"label": "Budget type", "name": "budget_type", "options": ["Fixed Budget", "Budget Range", "Open Competitive Bidding"], "required": true, "section": "Budget information", "type": "choice"}, {"label": "Fixed budget (JMD)", "minimum": 0, "name": "fixed_budget", "section": "Budget information", "type": "number", "required": true, "showWhen": {"field": "budget_type", "equals": "Fixed Budget"}}, {"label": "Estimated budget: minimum (JMD)", "minimum": 0, "name": "budget_minimum", "section": "Budget information", "type": "number", "required": true, "showWhen": {"field": "budget_type", "equals": "Budget Range"}}, {"label": "Estimated budget: maximum (JMD)", "minimum": 0, "name": "budget_maximum", "section": "Budget information", "type": "number", "required": true, "showWhen": {"field": "budget_type", "equals": "Budget Range"}}, {"label": "The successful bidder must have", "name": "required_qualifications", "options": ["Business Registration Certificate", "Tax Compliance Certificate (TCC)", "Public Liability Insurance", "Professional Certifications", "Industry Licences", "Health & Safety Certification", "Minimum Years of Experience", "Previous Similar Projects", "References", "Other"], "section": "Required qualifications", "type": "checkboxes"}, {"label": "Minimum years of experience", "minimum": 0, "name": "minimum_years", "section": "Required qualifications", "type": "number"}, {"label": "Other qualifications", "name": "qualifications_other", "section": "Required qualifications", "type": "text"}, {"label": "Suppliers must submit", "name": "required_documents", "options": ["Company Profile", "Business Registration Certificate", "Tax Compliance Certificate", "Insurance Certificate", "Project Portfolio", "Reference Letters", "Health & Safety Documentation", "Methodology Document", "Pricing Schedule", "Other"], "section": "Required documents", "type": "checkboxes", "required": true}, {"label": "Other documents", "name": "required_documents_other", "section": "Required documents", "type": "text"}, {"label": "Supplier question deadline", "name": "question_deadline", "section": "Procurement timeline", "type": "date", "required": true}, {"label": "Evaluation start date", "name": "evaluation_start_date", "section": "Procurement timeline", "type": "date", "required": true}, {"label": "Evaluation end date", "name": "evaluation_end_date", "section": "Procurement timeline", "type": "date", "required": true}, {"label": "Expected award date", "name": "expected_award_date", "section": "Procurement timeline", "type": "date", "required": true}, {"label": "Contract commencement date", "name": "contract_commencement_date", "section": "Procurement timeline", "type": "date", "required": true}, {"name": "clarification_email", "label": "Clarification email address: bidders may use this address to request clarification about the tender", "type": "email", "section": "Bidder clarifications", "required": true}, {"label": "Additional requirements, conditions or instructions to bidders", "name": "additional_information", "section": "Additional information", "type": "textarea"}, {"name": "terms_bid_confidentiality", "label": "Bid Confidentiality", "type": "checkboxes", "section": "Terms and agreements", "required": true, "options": ["Bids remain sealed and confidential until the tender closes."]}, {"name": "terms_bid_evaluation", "label": "Bid Evaluation", "type": "checkboxes", "section": "Terms and agreements", "required": true, "options": ["I am responsible for evaluating bids and selecting a supplier fairly."]}, {"name": "terms_contract_award", "label": "Contract Award", "type": "checkboxes", "section": "Terms and agreements", "required": true, "options": ["I am not obligated to award a contract. Any agreement is between me and the selected supplier."]}, {"name": "terms_tender_cancellation", "label": "Tender Cancellation", "type": "checkboxes", "section": "Terms and agreements", "required": true, "options": ["I may cancel a tender before an award, subject to applicable obligations."]}, {"name": "terms_platform_responsibility", "label": "Platform Responsibility", "type": "checkboxes", "section": "Terms and agreements", "required": true, "options": ["Caribbean Tender facilitates procurement but is not responsible for contracts between Buyers and Suppliers."]}, {"label": "Declaration", "name": "declaration", "options": ["I certify that I am authorized to issue this tender on behalf of the company and that the information provided is accurate and complete."], "required": true, "section": "Declaration", "type": "checkboxes"}, {"label": "Authorized representative name", "name": "representative_name", "required": true, "section": "Declaration", "type": "text"}, {"label": "Position", "name": "representative_position", "required": true, "section": "Declaration", "type": "text"}, {"label": "Date", "name": "declaration_date", "required": true, "section": "Declaration", "type": "date"}]}'::jsonb),
  ('supplier-proposal', 3, 'Bid Submission Form', 'supplier', false,
   (select download_path from public.form_definitions where key = 'supplier-proposal' and version = 2),
   '{"description": "The tender this bid is for is recorded automatically. Upload your supporting documents with the bid.", "fields": [{"label": "Company name", "name": "company_name", "required": true, "section": "Supplier information", "type": "text"}, {"label": "Trading name (if applicable)", "name": "trading_name", "section": "Supplier information", "type": "text"}, {"label": "TRN", "name": "trn", "required": true, "section": "Supplier information", "type": "text"}, {"label": "Years in operation", "minimum": 0, "name": "years_in_operation", "section": "Supplier information", "type": "number"}, {"label": "Company address", "name": "company_address", "required": true, "section": "Supplier information", "type": "text"}, {"label": "Contact person", "name": "contact_person", "required": true, "section": "Supplier information", "type": "text"}, {"label": "Position/Title", "name": "contact_position", "section": "Supplier information", "type": "text"}, {"label": "Telephone number", "name": "contact_phone", "required": true, "section": "Supplier information", "type": "text"}, {"label": "Email address", "name": "contact_email", "required": true, "section": "Supplier information", "type": "email"}, {"label": "Website (if applicable)", "name": "website", "section": "Supplier information", "type": "text"}, {"label": "Proposal summary: why your company is best suited to deliver", "name": "proposal_summary", "required": true, "section": "Proposal summary", "type": "textarea"}, {"label": "How you will carry out the work: key activities, processes, equipment, personnel and quality assurance", "name": "methodology", "required": true, "section": "Methodology and approach", "type": "textarea"}, {"columns": [{"label": "Item / Service", "name": "item", "required": true, "type": "text"}, {"label": "Description", "name": "description", "type": "text"}, {"label": "Quantity", "minimum": 0, "name": "quantity", "required": true, "type": "number"}, {"label": "Unit price (JMD)", "minimum": 0, "name": "unit_price", "required": true, "type": "number"}], "grandTotal": {"label": "Subtotal (JMD)"}, "label": "Pricing schedule", "lineTotal": {"label": "Total price (JMD)", "multiply": ["quantity", "unit_price"]}, "name": "pricing_schedule", "required": true, "section": "Pricing schedule", "type": "table"}, {"label": "GCT (if applicable, JMD)", "minimum": 0, "name": "gct", "section": "Pricing schedule", "type": "number"}, {"label": "Other charges (JMD)", "minimum": 0, "name": "other_charges", "section": "Pricing schedule", "type": "number"}, {"label": "Total bid value (JMD)", "minimum": 0, "name": "total_bid_value", "required": true, "section": "Pricing schedule", "type": "number"}, {"label": "Proposed start date", "name": "proposed_start_date", "section": "Project timeline", "type": "date", "required": true}, {"label": "Estimated completion date", "name": "estimated_completion_date", "section": "Project timeline", "type": "date", "required": true}, {"columns": [{"name": "milestone", "label": "Milestone", "type": "text", "required": true}, {"name": "target_date", "label": "Target date", "type": "date", "required": true}], "label": "Key milestones", "name": "milestones", "section": "Project timeline", "type": "table", "required": true}, {"columns": [{"label": "Name", "name": "name", "required": true, "type": "text"}, {"label": "Position", "name": "position", "type": "text"}, {"label": "Years of experience", "minimum": 0, "name": "years_experience", "type": "number"}, {"label": "Role on project", "name": "role", "type": "text"}], "label": "Key personnel assigned to this project", "name": "team_members", "section": "Team members", "type": "table"}, {"columns": [{"label": "Client", "name": "client", "required": true, "type": "text"}, {"label": "Project name", "name": "project_name", "required": true, "type": "text"}, {"label": "Contract value (JMD)", "minimum": 0, "name": "contract_value", "type": "number"}, {"label": "Year completed", "minimum": 1900, "name": "year_completed", "type": "number"}, {"label": "Description", "name": "description", "type": "text"}], "label": "Similar projects completed in the last five years", "name": "relevant_experience", "section": "Relevant experience", "type": "table"}, {"columns": [{"label": "Reference name", "name": "name", "required": true, "type": "text"}, {"label": "Company", "name": "company", "type": "text"}, {"label": "Position", "name": "position", "type": "text"}, {"label": "Telephone", "name": "phone", "required": true, "type": "text"}, {"label": "Email", "name": "email", "type": "text"}], "label": "References (at least one; two recommended)", "name": "bid_references", "required": true, "section": "References", "type": "table"}, {"label": "Supporting documents included with this bid", "name": "supporting_documents", "options": ["Business Registration Certificate", "Tax Compliance Certificate (TCC)", "NIS Compliance Certificate", "Public Liability Insurance", "Professional Certifications", "Company Profile", "Project Portfolio", "Reference Letters", "Health & Safety Policy", "Other Supporting Documents"], "section": "Supporting documents", "type": "checkboxes"}, {"label": "Declaration", "name": "declaration", "options": ["I/We certify that the information in this bid is true, accurate and complete to the best of our knowledge, and understand that false or misleading information may result in disqualification."], "required": true, "section": "Declaration", "type": "checkboxes"}, {"label": "Authorized representative name", "name": "representative_name", "required": true, "section": "Declaration", "type": "text"}, {"label": "Position", "name": "representative_position", "required": true, "section": "Declaration", "type": "text"}, {"label": "Date", "name": "declaration_date", "required": true, "section": "Declaration", "type": "date"}]}'::jsonb);

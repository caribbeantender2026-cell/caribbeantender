Deno.serve(async (req: Request) => {

  // ---------------------------------------------------------
  // CaribbeanTender Payment Webhook
  // LOCKED FOUNDATION VERSION
  //
  // This endpoint intentionally does NOT process payments yet.
  // It will remain locked until a payment provider is selected
  // and webhook signature verification is implemented.
  // ---------------------------------------------------------

  const headers = {
    "Content-Type": "application/json",
  };

  // Only POST will eventually be accepted.
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed"
      }),
      {
        status: 405,
        headers
      }
    );
  }

  // ---------------------------------------------------------
  // PAYMENT PROCESSING IS CURRENTLY DISABLED.
  //
  // Do not remove this block until:
  //
  // 1. A payment provider has been selected.
  // 2. The provider webhook secret has been configured.
  // 3. Webhook signature verification has been implemented.
  // 4. Provider product/price mapping has been configured.
  // 5. End-to-end webhook testing has been completed.
  // ---------------------------------------------------------

  return new Response(
    JSON.stringify({
      success: false,
      status: "locked",
      message:
        "CaribbeanTender payment webhook is configured but payment processing is not yet enabled."
    }),
    {
      status: 503,
      headers
    }
  );

});
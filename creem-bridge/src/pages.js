function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function paypalReturnTokenMatches(order, token) {
  return Boolean(order?.provider_order_id) && typeof token === 'string' && token === order.provider_order_id;
}

export function paymentResultPage({
  title,
  heading,
  message,
  tone = 'pending',
  order,
  accountUrl,
  retryUrl,
}) {
  const safeTitle = escapeHtml(title);
  const safeHeading = escapeHtml(heading);
  const safeMessage = escapeHtml(message);
  const safeOrderId = escapeHtml(order?.id || '');
  const safePlan = escapeHtml(order?.plan_key || '');
  const safeCredits = order?.credits == null ? '' : Number(order.credits).toLocaleString('en-US');
  const safeAccountUrl = accountUrl ? escapeHtml(accountUrl) : '';
  const safeRetryUrl = retryUrl ? escapeHtml(retryUrl) : '';
  const shouldRefresh = tone === 'pending' && safeRetryUrl;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${shouldRefresh ? `<meta http-equiv="refresh" content="4;url=${safeRetryUrl}">` : ''}
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f5f7fb; color: #172033; }
    main { width: min(560px, 100%); padding: 36px; border: 1px solid #e2e7f0; border-radius: 20px; background: #fff; box-shadow: 0 18px 45px rgba(26, 39, 64, .09); }
    .mark { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 50%; font-size: 28px; background: ${tone === 'success' ? '#e7f8ef' : tone === 'error' ? '#fff0f0' : '#eef4ff'}; }
    h1 { margin: 20px 0 10px; font-size: 28px; line-height: 1.25; }
    p { margin: 0; color: #59657a; line-height: 1.7; }
    dl { margin: 26px 0 0; padding: 18px; border-radius: 14px; background: #f7f9fc; }
    div.row { display: grid; grid-template-columns: 92px 1fr; gap: 12px; padding: 6px 0; }
    dt { color: #7b8699; }
    dd { margin: 0; overflow-wrap: anywhere; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
    a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 0 18px; border-radius: 10px; color: #fff; background: #1769e0; text-decoration: none; font-weight: 650; }
    a.secondary { color: #1769e0; background: #edf4ff; }
    small { display: block; margin-top: 22px; color: #8993a4; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">${tone === 'success' ? '✓' : tone === 'error' ? '!' : '…'}</div>
    <h1>${safeHeading}</h1>
    <p>${safeMessage}</p>
    ${order ? `<dl>
      <div class="row"><dt>订单</dt><dd>${safeOrderId}</dd></div>
      <div class="row"><dt>套餐</dt><dd>${safePlan}</dd></div>
      ${safeCredits ? `<div class="row"><dt>额度</dt><dd>${safeCredits} credits</dd></div>` : ''}
    </dl>` : ''}
    <nav>
      ${safeAccountUrl ? `<a href="${safeAccountUrl}">返回账户</a>` : ''}
      ${safeRetryUrl ? `<a class="secondary" href="${safeRetryUrl}">刷新状态</a>` : ''}
    </nav>
    <small>NexaRelay · PayPal 安全支付</small>
  </main>
</body>
</html>`;
}

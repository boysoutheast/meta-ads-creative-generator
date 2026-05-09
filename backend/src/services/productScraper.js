/**
 * productScraper.js
 *
 * Fetches a product page (Shopify, Amazon, Tokopedia, etc), extracts metadata,
 * then uses GPT-4o to parse structured product info → returns { product, brief, imageUrl }
 *
 * The `brief` is pre-formatted for direct use in /build-storyboard.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { chatCompletion } = require('./apimart');

async function scrapeProduct(url) {
  if (!url || typeof url !== 'string') throw new Error('url is required');

  // 1. Fetch HTML
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdsCreativeGen-Bot/1.0)' },
    maxRedirects: 5,
  });

  // 2. Extract surface-level metadata with cheerio
  const $ = cheerio.load(html);
  const rawText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text().trim() ||
    '';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const imageUrl =
    $('meta[property="og:image"]').attr('content') ||
    $('img[class*="product" i]').first().attr('src') ||
    null;

  // 3. Use GPT-4o to parse structured product data from the text
  const parsed = await chatCompletion({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Extract product info from this webpage text. Return ONLY valid JSON, no markdown:
{ "productName": "", "brand": "", "price": "", "currency": "", "features": ["max 5 bullet points"], "description": "max 100 words", "targetAudience": "" }

Webpage title: ${title}
Meta description: ${description}
Page text: ${rawText}`,
      },
    ],
    maxTokens: 600,
    temperature: 0.1,
  });

  let product = {};
  try {
    const match = parsed.match(/\{[\s\S]*\}/);
    product = match ? JSON.parse(match[0]) : {};
  } catch {
    product = { productName: title, description };
  }

  const brief = `Product: ${product.productName || title}${product.brand ? ` by ${product.brand}` : ''}
${product.price ? `Price: ${product.currency || ''} ${product.price}` : ''}
Key Features: ${(product.features || []).join(', ')}
Description: ${product.description || description}
Target Audience: ${product.targetAudience || 'General consumers'}

Create a compelling product ad that showcases the benefits and drives purchase intent.`;

  return { product, brief: brief.trim(), imageUrl };
}

module.exports = { scrapeProduct };

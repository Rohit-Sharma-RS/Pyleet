export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const { slug } = req.query;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug parameter' });
  }

  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        titleSlug
        content
        difficulty
        exampleTestcases
        metaData
        codeSnippets {
          lang
          langSlug
          code
        }
      }
    }
  `;

  try {
    const response = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        query,
        variables: { titleSlug: slug }
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'LeetCode API error' });
    }

    const data = await response.json();

    if (!data.data || !data.data.question) {
      return res.status(404).json({ error: 'Problem not found. Make sure the URL is correct and the problem is not premium-only.' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json(data.data.question);
  } catch (error) {
    console.error('Error fetching from LeetCode:', error);
    return res.status(500).json({ error: 'Failed to fetch problem data' });
  }
}

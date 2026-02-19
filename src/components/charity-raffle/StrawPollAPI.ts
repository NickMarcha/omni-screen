/**
 * StrawPoll.com API client. Requires API key from https://strawpoll.com/account
 */
export interface ProcessedDonation {
  NR: number
  message: string
  sponsor: string
  yeeOrPepe: 'YEE' | 'PEPE' | 'NONE'
}

export interface ResultEntry {
  value: string
  vote_points: number
  vote_count: number
}

const POLL_OPS = {
  title: 'What is up next?',
  media: {
    id: 'poy9NPNwnJr',
    type: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6b/Against_Malaria_Foundation.svg/1200px-Against_Malaria_Foundation.svg.png',
    width: 640,
    height: 480,
  },
  poll_options: [] as { id: number; type: string; value: string }[],
  poll_config: {
    allow_comments: false,
    deadline_at: 0,
    duplication_checking: 'ip' as const,
    is_multiple_choice: true,
    is_private: true,
    randomize_options: true,
    results_visibility: 'after_deadline' as const,
    type: 'ranking' as const,
  },
}

export async function createPoll(
  apiKey: string,
  deadlineSeconds: number,
  donos: ProcessedDonation[]
): Promise<string> {
  const res = await fetch('https://api.strawpoll.com/v3/polls', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...POLL_OPS,
      poll_config: { ...POLL_OPS.poll_config, deadline_at: Math.floor((Date.now() + deadlineSeconds * 1000) / 1000) },
      poll_options: donos.map((d) => ({ id: d.NR, type: 'text', value: d.message })),
    }),
  })
  if (!res.ok) throw new Error(`StrawPoll API: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.id
}

export async function getPollResultsArray(apiKey: string, pollId: string): Promise<ResultEntry[]> {
  const res = await fetch(`https://api.strawpoll.com/v3/polls/${pollId}/results`, {
    headers: { 'X-API-Key': apiKey },
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.poll_options ?? []) as ResultEntry[]
}

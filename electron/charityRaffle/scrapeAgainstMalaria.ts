/**
 * Against Malaria donation scraper. Ported from RaffleDashboard.
 *
 * Two scrape modes:
 * 1. Single-page (scrapeJob style): Distribution status changes over time
 *    (e.g. "En-route to country" → "Arrived in country" → "Distribution complete").
 *    Running this every 15 minutes overwrites RawData with fresh values so status
 *    updates are captured.
 * 2. Multi-page (scrapeNPages style): Loops through all pages until the sheet
 *    catches up with the full donation list.
 */
import type { Element } from 'domhandler'
import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { Donation } from './types.js'
import { fileLogger } from '../fileLogger.js'

const tableSelector = '#MainContent_UcFundraiserSponsors1_grdDonors'
const rowSelectorOne = 'tr.TableItemStyle.TableItemText'
const rowSelectorTwo = 'tr.TableAlternatingItemStyle.TableItemText'
const totalSelector = '#MainContent_UcFundraiserSponsors1_ucPager2_pnlTextCounter'
const nextPageSelector = 'MainContent_UcFundraiserSponsors1_ucPager1_lnkNext'

function log(level: 'info' | 'warn' | 'error', msg: string, args: unknown[] = []) {
  try {
    fileLogger.writeLog(level, 'main', `[CharityRaffle] ${msg}`, args)
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getPageInfo(page: CheerioAPI) {
  const totalArray = page(totalSelector)
    .text()
    .trim()
    .split(' ')
    .filter((str) => str !== '')

  const currentSponsorCountStart = parseInt(totalArray[1], 10)
  const currentSponsorCountEnd = parseInt(totalArray[3], 10)
  const totalDonations = parseInt(totalArray[5], 10)

  return { currentSponsorCountStart, currentSponsorCountEnd, totalDonations }
}

interface CellEntry {
  data: Cheerio<Element>
  index: number
}

function scrapeDonation(root: CheerioAPI, element: Element): Donation | null {
  const rowData: CellEntry[] = []
  root(element)
    .find('td, th')
    .each((j, cell) => {
      rowData.push({ data: root(cell), index: j })
    })

  let shift = 0

  switch (rowData.length) {
    case 13:
      log('info', 'Reoccurring donation row (13 cols)', [])
      shift = 1
      break
    case 12:
      shift = 0
      break
    case 0:
      return null
    default:
      log('error', 'Unexpected row column count', [rowData.length])
      throw new Error(`Unexpected columns: ${rowData.length}`)
  }

  const sortedData = rowData
    .sort((a, b) => a.index - b.index)
    .map((a) => a.data)

  const first = sortedData[0]
  if (
    !first ||
    !first.children().first().attr('class')
  ) {
    return null
  }

  const flagCodeStr = first.children().first().attr('class')?.split('-')[1]
  const flagCode = flagCodeStr ?? 'none'
  const sponsor = sortedData[1].text().trim()
  const date = sortedData[2].text().trim()
  const location = sortedData[3].text().trim()

  function parseDollars(str: string): number {
    if (str === '') return 0
    try {
      const match = str.substring(3).replace(',', '')
      const parsed = parseFloat(match)
      return isNaN(parsed) ? 0 : parsed
    } catch {
      return 0
    }
  }

  const amount = sortedData[4 + shift].children().first().text().trim()
  const USDollarAmount = parseDollars(sortedData[5 + shift].text().trim())
  const giftAid = parseDollars(sortedData[6 + shift].text().trim())
  const message = sortedData[7 + shift].text().trim()

  let distributionFlag = 'none'
  try {
    const data = sortedData[8 + shift]
      .children()
      .first()
      .children()
      .last()
      .attr('class')
      ?.split('-')[1]
    distributionFlag = data ?? distributionFlag
  } catch {
    /* ignore */
  }

  let distributionStatus = 'none'
  try {
    const title = sortedData[9 + shift].children().first()?.attr('title')
    if (title) distributionStatus = title
  } catch {
    /* ignore */
  }

  const numberOfNetsFunded = parseInt(sortedData[10 + shift].text(), 10) || 0
  const numberOfPeopleSaved = parseInt(sortedData[11 + shift].text(), 10) || 0

  return new Donation(
    flagCode,
    sponsor,
    date,
    location,
    amount,
    USDollarAmount,
    giftAid,
    message,
    distributionFlag,
    distributionStatus,
    numberOfNetsFunded,
    numberOfPeopleSaved
  )
}

function scrapePageFromCheerio(page: CheerioAPI): Donation[] {
  const vOneRows = page(`${tableSelector} ${rowSelectorOne}`)
  const vTwoRows = page(`${tableSelector} ${rowSelectorTwo}`)
  const allRows: Element[] = []

  vOneRows.each((index, element) => {
    allRows.push(element)
    allRows.push(vTwoRows[index])
  })

  return allRows
    .map((row) => scrapeDonation(page, row))
    .filter((d): d is Donation => d !== null)
}

/**
 * Single-page scrape: fetches first page only. Use for status updates
 * (distribution status changes over time; overwriting catches updates).
 */
export async function scrapeSinglePage(fundraiserId: string): Promise<DonationBatch> {
  const ds = await DonationsScraper.createScraper(fundraiserId, 1)
  try {
    const batch = await ds.donationBatch()
    return batch
  } finally {
    await ds.close()
  }
}

export interface DonationBatch {
  donations: Donation[]
  pageCount: number
  startSponsorCount: number
  endSponsorCount: number
  totalDonations: number
}

/**
 * Multi-page scraper. Keeps browser open and navigates through pages until
 * sheet catches up. Ported from RaffleDashboard.
 */
export class DonationsScraper {
  private browser: Browser
  private page: Page
  private rootCheerio: CheerioAPI
  private totalDonations: number
  private scrapedDonations = 0
  private pageCount = 0
  private pagesToScrape: number
  private promises: Promise<unknown>[] = []

  private constructor(
    browser: Browser,
    page: Page,
    rootCheerio: CheerioAPI,
    totalDonations: number,
    pagesToScrape: number = -1
  ) {
    this.browser = browser
    this.page = page
    this.rootCheerio = rootCheerio
    this.totalDonations = totalDonations
    this.pagesToScrape = pagesToScrape
  }

  static async createScraper(
    fundraiserId: string,
    pagesToScrape: number = -1
  ): Promise<DonationsScraper> {
    const scrapeURL = `https://www.againstmalaria.com/Fundraiser.aspx?FundraiserID=${fundraiserId}`
    log('info', 'Starting scraper', [{ scrapeURL }])

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    })
    log('info', 'Puppeteer browser launched', [])

    const page = await browser.newPage()
    log('info', 'Navigating to URL', [scrapeURL])
    await page.goto(scrapeURL)
    log('info', 'Page loaded, fetching content', [])

    const htmlString = await page.content()
    const rootCheerio = load(htmlString)
    const pageInfo = getPageInfo(rootCheerio)
    log('info', 'Page info parsed', [pageInfo])

    return new DonationsScraper(
      browser,
      page,
      rootCheerio,
      pageInfo.totalDonations,
      pagesToScrape
    )
  }

  async close(): Promise<void> {
    await this.browser.close()
    log('info', 'Puppeteer browser closed', [])
  }

  get totalDonationsCount(): number {
    return this.totalDonations
  }

  /**
   * Scrapes the current page. If navigating, awaits the previous click + sleep first.
   */
  async donationBatch(): Promise<DonationBatch> {
    await Promise.all(this.promises)
    this.promises = []

    const htmlString = await this.page.content()
    this.rootCheerio = load(htmlString)

    const currentPageInfo = getPageInfo(this.rootCheerio)
    const tableExists = this.rootCheerio(tableSelector).length > 0
    log('info', 'DonationBatch', [{ tableExists, scrapedDonations: this.scrapedDonations, currentEnd: currentPageInfo.currentSponsorCountEnd }])

    if (currentPageInfo.currentSponsorCountEnd >= this.scrapedDonations) {
      const newDonations = scrapePageFromCheerio(this.rootCheerio)
      this.scrapedDonations += newDonations.length
      this.pageCount++
      log('info', 'Donations scraped', [{ count: newDonations.length, pageCount: this.pageCount }])
      return {
        donations: newDonations,
        pageCount: this.pageCount,
        startSponsorCount: currentPageInfo.currentSponsorCountStart,
        endSponsorCount: currentPageInfo.currentSponsorCountEnd,
        totalDonations: this.totalDonations,
      }
    }

    log('info', 'Already scraped current page', [])
    return {
      donations: [],
      pageCount: this.pageCount,
      startSponsorCount: currentPageInfo.currentSponsorCountStart,
      endSponsorCount: currentPageInfo.currentSponsorCountEnd,
      totalDonations: this.totalDonations,
    }
  }

  /**
   * Schedules navigation to next page. Returns false if no next page.
   */
  async goToNextPage(): Promise<boolean> {
    if (
      this.scrapedDonations >= this.totalDonations ||
      (this.pagesToScrape >= 0 && this.pagesToScrape === this.pageCount)
    ) {
      log('info', 'No next page: reached end or limit', [{ scrapedDonations: this.scrapedDonations, totalDonations: this.totalDonations, pageCount: this.pageCount }])
      return false
    }

    const nextPageButton = this.rootCheerio(`#${nextPageSelector}`)
    if (nextPageButton.length === 0) {
      log('info', 'No next page button', [])
      return false
    }

    const nextButtonElement = await this.page.waitForSelector(`[id="${nextPageSelector}"]`)
    if (nextButtonElement === null) {
      log('info', 'No next page button (Puppeteer)', [])
      return false
    }

    const anchor = await nextButtonElement.toElement('a')
    this.promises = [sleep(20000), anchor.evaluate((node) => (node as HTMLAnchorElement).click())]
    log('info', 'Going to next page', [{ pageCount: this.pageCount }])
    return true
  }
}

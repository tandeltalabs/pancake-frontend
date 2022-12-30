import { FixedNumber } from '@ethersproject/bignumber'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { formatUnits } from '@ethersproject/units'
import { createMulticall } from '@pancakeswap/multicall'
import { GraphQLClient } from 'graphql-request'
import uniqBy from 'lodash/uniqBy'

// love you defillama
const llamaPriceUrl = 'https://coins.llama.fi/prices/current/'

const getCoinsPrice = async (tokens: SmartChefToken[]) => {
  const tokensString = tokens
    .map((t) => {
      return `bsc:${t.id}`
    })
    .join(',')
  const data = await fetch(`${llamaPriceUrl}${tokensString}`)
  const json = await data.json<{ coins: Record<string, { price: number }> }>()

  return json.coins
}

const BSC_BLOCK_TIME = 3

const BLOCKS_PER_YEAR = (60 / BSC_BLOCK_TIME) * 60 * 24 * 365 // 10512000

export const getPoolApr = (
  stakingTokenPrice: string,
  rewardTokenPrice: string,
  totalStaked: string,
  tokenPerBlock: string,
): string => {
  const totalRewardPricePerYear = FixedNumber.from(rewardTokenPrice)
    .mulUnsafe(FixedNumber.from(tokenPerBlock))
    .mulUnsafe(FixedNumber.from(BLOCKS_PER_YEAR))
  const totalStakingTokenInPool = FixedNumber.from(stakingTokenPrice).mulUnsafe(FixedNumber.from(totalStaked))
  const apr = totalRewardPricePerYear.divUnsafe(totalStakingTokenInPool).mulUnsafe(FixedNumber.from(100))
  return apr.toString()
}

const URL = 'https://api.thegraph.com/subgraphs/name/pancakeswap/smartchef'

const bscProvider = new StaticJsonRpcProvider(
  {
    url: 'https://nodes.pancakeswap.com',
    skipFetchSetup: true,
  },
  56,
)

const { multicallv2 } = createMulticall(() => bscProvider)

const client = new GraphQLClient(URL, {
  fetch,
})

interface SmartChefToken {
  id: string
  symbol: string
  decimals: string
}

interface SmartChef {
  id: string
  stakeToken: SmartChefToken
  earnToken: SmartChefToken
  reward: string
  startBlock: string
  endBlock: string
  totalStaked: string
}

export const getActivePools = async () => {
  const blockNumber = await bscProvider.getBlockNumber()
  const query = `
         query {
  smartChefs(where: { endBlock_gte: ${blockNumber}, startBlock_lt: ${blockNumber} }) {
    id
    stakeToken {
      id
      symbol
      decimals
    }
    earnToken {
      id
      symbol
      decimals
    }
    reward
    startBlock
    endBlock
  }
}
  `

  const resp = (await client.request(query)) as {
    smartChefs: SmartChef[]
  }
  const totalStaked = await getTotalStaked(resp.smartChefs)

  const stakeTokens = resp.smartChefs.map(({ stakeToken }) => stakeToken)
  const earnTokens = resp.smartChefs.map(({ earnToken }) => earnToken)

  const tokensUniq = uniqBy([...stakeTokens, ...earnTokens], 'id')

  const tokensPrice = await getCoinsPrice(tokensUniq)

  return resp.smartChefs.map((pool, i) => {
    const { stakeToken, earnToken } = pool

    const stakeTokenPrice = tokensPrice[`bsc:${stakeToken.id}`].price
    const earnTokenPrice = tokensPrice[`bsc:${earnToken.id}`].price
    const totalStakedFormatted = formatUnits(totalStaked[i][0], stakeToken.decimals)

    return {
      ...pool,
      stakeTokenPrice,
      earnTokenPrice,
      apr:
        stakeTokenPrice && earnTokenPrice && totalStakedFormatted
          ? getPoolApr(String(stakeTokenPrice), String(earnTokenPrice), totalStakedFormatted, pool.reward)
          : null,
      totalStaked: totalStakedFormatted,
    }
  })
}

const balanceOfAbi = ['function balanceOf(address _owner) view returns (uint256 balance)']

export const getTotalStaked = (pools: any[]) => {
  const poolsBalanceOf = pools.map((poolConfig) => {
    return {
      address: poolConfig.stakeToken.id,
      name: 'balanceOf',
      params: [poolConfig.id],
    }
  })
  return multicallv2({
    abi: balanceOfAbi,
    calls: poolsBalanceOf,
  })
}

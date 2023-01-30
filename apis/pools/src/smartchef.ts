import { ChainId, Currency, CurrencyAmount, Token } from '@pancakeswap/sdk'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { BUSD_BSC } from '@pancakeswap/tokens'
import { FixedNumber } from '@ethersproject/bignumber'
import { getAllCommonPairs, getBestTradeExactIn, Trade } from '@pancakeswap/smart-router/evm'
import { formatUnits } from '@ethersproject/units'
import { GraphQLClient } from 'graphql-request'
import uniqBy from 'lodash/uniqBy'
import { createMulticall } from '@pancakeswap/multicall'

const BUSD_AMOUNT = CurrencyAmount.fromRawAmount(BUSD_BSC, 1e18)

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

const getCurrencyPrice = async (currency: Currency) => {
  const paris = await getAllCommonPairs(currency, BUSD_AMOUNT.currency, { provider: () => bscProvider })

  const trade = await getBestTradeExactIn(BUSD_AMOUNT, currency, {
    provider: () => bscProvider,
    allCommonPairs: paris,
  })

  if (!trade) return null

  const price = Trade.executionPrice(trade).invert().toSignificant(6)

  return price
}

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

  const stakeTokensUniq = uniqBy(stakeTokens, 'id')
  const earnTokensUniq = uniqBy(earnTokens, 'id')

  const stakeTokensPrice = await Promise.all(
    stakeTokensUniq.map((token) => getCurrencyPrice(new Token(ChainId.BSC, token.id, +token.decimals, token.symbol))),
  )

  const earnTokensPrice = await Promise.all(
    earnTokensUniq.map((token) => getCurrencyPrice(new Token(ChainId.BSC, token.id, +token.decimals, token.symbol))),
  )

  return resp.smartChefs.map((pool, i) => {
    const { stakeToken, earnToken } = pool
    const findStakeTokenIndex = stakeTokensUniq.findIndex((t) => t.id === stakeToken.id)
    const findEarnTokenIndex = earnTokensUniq.findIndex((t) => t.id === earnToken.id)

    const stakeTokenPrice = stakeTokensPrice[findStakeTokenIndex]
    const earnTokenPrice = earnTokensPrice[findEarnTokenIndex]
    const totalStakedFormatted = formatUnits(totalStaked[i][0], stakeToken.decimals)

    let apr: string | null = '0'

    try {
      apr =
        stakeTokenPrice && earnTokenPrice && totalStakedFormatted
          ? getPoolApr(stakeTokenPrice, earnTokenPrice, totalStakedFormatted, pool.reward)
          : null
    } catch (error) {
      console.log(pool, error)
    }

    return {
      ...pool,
      stakeTokenPrice,
      earnTokenPrice,
      apr,
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

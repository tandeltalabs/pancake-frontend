import { createReducer } from '@reduxjs/toolkit'
import { atomWithReducer } from 'jotai/utils'
import {
  Field,
  replaceBuyCryptoState,
  resetBuyCryptoState,
  selectCurrency,
  setMinAmount,
  setRecipient,
  setUsersIpAddress,
  typeInput,
} from './actions'

export interface BuyCryptoState {
  readonly typedValue: string
  readonly recipient: string | null
  readonly [Field.INPUT]: {
    readonly currencyId: string | undefined
  }
  readonly [Field.OUTPUT]: {
    readonly currencyId: string | undefined
  }
  readonly minAmount: string
  readonly minBaseAmount: string
  readonly userIpAddress: string | null
}

const initialState: BuyCryptoState = {
  typedValue: '',
  recipient: null,
  [Field.INPUT]: {
    currencyId: '',
  },
  [Field.OUTPUT]: {
    currencyId: '',
  },
  minAmount: '',
  minBaseAmount: '',
  userIpAddress: null,
}

export const reducer = createReducer<BuyCryptoState>(initialState, (builder) =>
  builder
    .addCase(resetBuyCryptoState, () => initialState)
    .addCase(typeInput, (state, { payload: { typedValue } }) => {
      return {
        ...state,
        typedValue,
      }
    })
    .addCase(selectCurrency, (state, { payload: { currencyId, field } }) => {
      return {
        ...state,
        [field]: { currencyId },
      }
    })
    .addCase(setMinAmount, (state, { payload: { minAmount, minBaseAmount } }) => {
      state.minAmount = minAmount
      state.minBaseAmount = minBaseAmount
    })
    .addCase(setRecipient, (state, { payload: { recipient } }) => {
      state.recipient = recipient
    })
    .addCase(setUsersIpAddress, (state, { payload: { ip } }) => {
      state.userIpAddress = ip
    })
    .addCase(
      replaceBuyCryptoState,
      (state, { payload: { typedValue, recipient, inputCurrencyId, outputCurrencyId, minAmount, minBaseAmount } }) => {
        return {
          [Field.INPUT]: {
            currencyId: inputCurrencyId,
          },
          [Field.OUTPUT]: {
            currencyId: outputCurrencyId,
          },
          typedValue,
          recipient,
          minAmount,
          minBaseAmount,
          userIpAddress: state.userIpAddress,
        }
      },
    ),
)

export const buyCryptoReducerAtom = atomWithReducer(initialState, reducer)

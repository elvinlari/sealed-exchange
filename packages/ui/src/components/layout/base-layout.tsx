"use client";

import React, { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { Header } from "./header";
import { TopNav } from "./top-nav";
import { useWalletStore } from "@/stores/wallet-store";


const topNav = [
  {
    title: 'Trade',
    href: '/',
    isActive: true,
    disabled: false,
  },
  {
    title: 'Balances',
    href: '/balance',
    isActive: true,
    disabled: false,
  },
  {
    title: 'Tokens',
    href: '/admin',
    isActive: true,
    disabled: false,
  },
  {
    title: 'Vault',
    href: '/vault',
    isActive: true,
    disabled: false,
  },
    {
    title: 'Events',
    href: '/event',
    isActive: true,
    disabled: false,
  }
]


type BaseLayoutProps = {
  children?: React.ReactNode
}

export function BaseLayout({ children }: BaseLayoutProps) {
  const { account, connectWallet, disconnectWallet, checkConnection } = useWalletStore()

  // Check for existing wallet connection on mount
  useEffect(() => {
    checkConnection()
  }, [checkConnection])


  return (
    <>
    <Header fixed>
        <div className="flex items-center gap-6 w-full">
          {/* Logo/Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-base">🔐</span>
            </div>
            <div className="block">
              {/* Mobile: Stacked layout */}
              <h1 className="md:hidden text-sm font-bold leading-tight">
                <span className="block bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Sealed
                </span>
                <span className="block bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Exchange
                </span>
              </h1>
              {/* Desktop: Single line with descriptor */}
              <h1 className="hidden md:block text-lg font-bold leading-tight whitespace-nowrap">
                <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Sealed Exchange
                </span>
                <span className="text-muted-foreground font-normal text-xs ml-2">
                  · Trade encrypted tokens
                </span>
              </h1>
            </div>
          </div>

          {/* Navigation and Wallet */}
          <TopNav 
            links={topNav}
            account={account}
            onConnect={connectWallet}
            onDisconnect={disconnectWallet}
          />
        </div>
    </Header>
    {children ?? <Outlet />}
    </>
  )
}

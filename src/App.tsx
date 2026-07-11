import { BrowserRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UpdateModal } from '@/components/UpdateModal'
import Augments from '@/pages/Augments'
import Home from '@/pages/Home'
import Live from '@/pages/Live'
import Overlay from '@/pages/Overlay'
import Review from '@/pages/Review'

const queryClient = new QueryClient()

const NAV = [
  { to: '/', label: 'Build' },
  { to: '/live', label: 'Live' },
  { to: '/review', label: 'Review' },
  { to: '/augments', label: 'Augments' },
]

function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <UpdateModal />
      <nav className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
          <span className="font-bold tracking-tight text-sky-400">
            LoL Build Coach{' '}
            <span className="text-[10px] font-medium text-zinc-500">v{__APP_VERSION__}</span>
          </span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-zinc-800 px-4 py-4 text-center text-xs text-zinc-600">
        LoL Build Coach v{__APP_VERSION__} · isn’t endorsed by Riot Games and doesn’t reflect the views
        or opinions of Riot Games or anyone officially involved in producing or
        managing League of Legends. League of Legends and Riot Games are
        trademarks or registered trademarks of Riot Games, Inc.
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Bare route for the transparent in-game overlay window */}
          <Route path="/overlay" element={<Overlay />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Live />} />
            <Route path="/review" element={<Review />} />
            <Route path="/augments" element={<Augments />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

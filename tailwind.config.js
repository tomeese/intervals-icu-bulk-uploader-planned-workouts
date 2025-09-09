/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',  // matches your current behavior
  content: [
    "./docs/**/*.{html,js}",
    "./docs/index.html",
  ],
  safelist: [
    // layout scaffolding used throughout the page
    'max-w-6xl','mx-auto','px-4','sm:px-6','lg:px-8','py-6',
    'grid','grid-cols-1','sm:grid-cols-2','md:grid-cols-2','xl:grid-cols-5','gap-2','gap-3','gap-4',
    'hidden','block','flex','inline-flex','items-center','justify-between',
    'space-y-2','space-y-4','space-y-6',
    'text-xs','text-sm','text-base','text-lg','text-2xl','font-semibold','font-medium',
    'rounded-lg','rounded-xl','border','border-slate-200','dark:border-slate-800',
    'bg-white','dark:bg-slate-800','bg-slate-50','dark:bg-slate-900','text-slate-500'
  ],
  theme: { extend: {} },
  plugins: [],
};

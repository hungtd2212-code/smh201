/** Biểu tượng chiếc răng, cùng nét vẽ với bộ icon lucide (bộ này không có hình răng). */
export function ToothIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 5.6C10.6 4.4 9.2 3.5 7.5 3.5 5 3.5 3.5 5.5 3.5 8c0 1.9.6 3.4 1.2 5 .5 1.3.7 2.800 1 4.300.3 1.700.8 3.200 2 3.200 1.300 0 1.600-1.500 1.900-3 .3-1.400.8-2.500 2.400-2.500s2.100 1.100 2.400 2.500c.3 1.500.6 3 1.900 3 1.200 0 1.700-1.500 2-3.200.3-1.500.5-3 1-4.300.6-1.600 1.200-3.100 1.200-5 0-2.500-1.500-4.500-4-4.500-1.700 0-3.100.9-4.500 2.100z" />
    </svg>
  );
}

const COMMON = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'changeme123', 'changeme123!', 'admin12345', 'letmein123', 'welcome123', 'iloveyou12', 'taptowash', 'taptowash1'];

// Returns an error message, or '' when the password is acceptable.
function passwordProblem(pw, { email = '', name = '' } = {}) {
  pw = String(pw || '');
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.';
  const low = pw.toLowerCase();
  if (COMMON.includes(low)) return 'That password is too common. Choose something less guessable.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return 'The password must not contain your email name.';
  const first = String(name).trim().split(/\s+/)[0].toLowerCase();
  if (first.length >= 4 && low.includes(first)) return 'The password must not contain your name.';
  if (/^(.)\1+$/.test(pw)) return 'The password must not be one repeated character.';
  return '';
}

module.exports = { passwordProblem };

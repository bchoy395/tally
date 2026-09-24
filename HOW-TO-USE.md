# How to use Tally

Tally keeps track of your bank accounts, credit cards, bills and budget. It runs on this computer, and your information stays on this computer. Nothing goes on the internet.


## Starting Tally

1. On your **Desktop**, double-click the **tally** folder to open it.
2. Double-click the file named **Tally** (its type says "Windows Batch File").
   - There is also a file called **Tally.command**. Ignore it; that one is for Mac.
3. A **black window** opens with some text in it. **Leave it open.** Tally only works while it is open. You can make it smaller by clicking the **_** button in its top-right corner.
4. Your web browser opens Tally by itself after a few seconds.
   - If it doesn't, open your web browser, type **localhost:4280** at the top where you'd normally type a website, and press **Enter**.

The first time only, Windows might show a blue box that says "Windows protected your PC". Click **More info**, then **Run anyway**.


## Closing Tally

1. Close the Tally tab in your browser.
2. Close the **black window** by clicking the **X** in its top-right corner.

You don't need to save anything first. Tally saves each change as soon as you make it.


## Using Tally

- **Your accounts** are listed down the left side with their balances. Click one to see its transactions.
- **Home** (top left) shows a summary: what you have, what you've spent this month, and bills coming up.
- **To add a transaction:** click the blue **+ New** button (or press the **N** key). Fill in:
  - the **date**
  - the **payee** (who you paid, or who paid you)
  - the amount under **Payment** (money going out) or **Deposit** (money coming in)
  - the **category**, like Groceries

  Then click **Save**.
- **To change a transaction:** click the **Edit** button at the right end of its row. Clicking the row itself only highlights it.
- **To delete a transaction:** click **Edit**, then **Delete** in the bottom-left corner.
- **Bills & recurring** lists bills that are coming up. When you've paid one, click **Enter** next to it and it's recorded for you.
- **Budget** shows how much you've spent in each category this month compared with what you planned.
- **Reports** shows where your money goes, with charts.


## Where your information is kept

There are two separate things on this computer:

1. **The program**: the **tally** folder on your Desktop. Brianna makes improvements on her computer and sends them to you through a website called GitHub.
2. **Your information**: your accounts, transactions and budget. It's kept in a separate, hidden folder: `C:\Users\(your name)\AppData\Roaming\Tally`

**Getting updates only changes the program. It never touches your information.** Even if the tally folder on the Desktop were deleted, your information would still be there.

Tally also makes a backup copy of your information every day, all by itself.

For extra safety, about once a month:
1. In Tally, click **Settings** (bottom left).
2. Click **Download backup**.
3. Copy the file it saves (in your Downloads folder) to a USB stick.


## Getting updates from Brianna

Only do this when Brianna tells you there's an update.

1. **Close Tally first.** Close the browser tab and the black window.
2. Open the **tally** folder on your Desktop.
3. At the top of that window is a bar that says **Desktop > tally**. Click once on the empty space at the right end of that bar. The text changes to something like `C:\Users\...\Desktop\tally` and is highlighted.
4. Type the word **powershell** and press **Enter**.
5. A new window opens (usually blue or black). Its last line ends in `\Desktop\tally>` and has a blinking cursor after it.
6. Type exactly this, then press **Enter**:

   ```
   git pull
   ```

7. Wait a few seconds until the blinking cursor comes back. You'll see one of these, and **both mean it worked**:
   - `Already up to date.` There was nothing new.
   - A list of file names ending with something like `3 files changed`. The update is installed.
8. Close that window with the **X** in its top-right corner.
9. Start Tally again, the same way as always.


## If something goes wrong

Don't worry. **None of these can harm your information.** They only affect the program.

- **The browser says "This site can't be reached."** The black window was closed. Start Tally again.
- **The black window says "Tally is already running."** Tally was already open. Your browser opens it anyway.
- **The black window says "Tally needs Node.js."** Call Brianna.
- **After typing git pull, it says "git is not recognized".** Call Brianna.
- **A window pops up asking you to sign in to GitHub.** Close it and call Brianna. Please don't try other passwords.
- **Red text, or any message you're not sure about.** Take a photo of the screen with your phone and send it to Brianna.
